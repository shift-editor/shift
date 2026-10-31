import { ascending, byCodePoint, comparing, EntityMap } from "@shift/types";
import type {
  AppliedChange,
  FontReplacement,
  AnchorId,
  ContourData,
  ContourId,
  FontSnapshot,
  GlyphEntry,
  GlyphId,
  GlyphName,
  GlyphProjection,
  GlyphRecord,
  GlyphRecordChanges,
  ReadonlyEntityMap,
  GlyphSnapshot,
  GlyphStructure,
  GlyphState,
  InterpolationBasis,
  LayerId,
  LayerReplaced,
  PointData,
  PointId,
  SegmentId,
  SourceId,
  Unicode,
  WorkspaceGlyphLayerSnapshot,
  WorkspaceSnapshot,
} from "@shift/types";
import { segmentIdFor } from "@shift/glyph-state";
import { Validate } from "@shift/validation";
import {
  batch,
  computed,
  signal,
  track,
  type Signal,
  type WritableSignal,
} from "../signals/signal";
import type {
  FontEngine,
  FontRecordIndex,
  FontStoreOptions,
  GlyphSourceKey,
} from "../../types/font";
import type { GlyphObjectIndex, GlyphObjectSegment } from "../../types/glyph";
import { GlyphLayerState, type LayerUpdate } from "./GlyphLayerState";
import { Kerning, KerningRecords } from "./Kerning";
import type { Glyph } from "./Glyph";
import type { EngineEdit } from "../wasm/engine";

/**
 * Renderer-local owner for font records, concrete glyph layer state, glyphs, and views.
 *
 * Workspace mutation and async read ordering are owned by
 * `WorkspaceEditCoordinator`. This store materializes returned glyph snapshots
 * into layer state and indexes objects from that concrete state.
 */
/**
 * Glyphs whose committed outlines changed, published once per commit. A new object each time,
 * so an unchanged list (including `null`) still notifies.
 */
export interface GlyphInvalidation {
  /** Changed glyph roots and their dependents, or `null` when every glyph may have changed. */
  readonly glyphIds: readonly GlyphId[] | null;
}

export class FontStore {
  readonly #font: WritableSignal<FontSnapshot | null>;
  readonly #workspace: WritableSignal<WorkspaceSnapshot | null>;
  readonly #engine: FontEngine | null;
  readonly #kerning: Signal<Kerning>;
  readonly #committedRevision: WritableSignal<number>;
  readonly #invalidGlyphs: WritableSignal<GlyphInvalidation>;

  /**
   * Object ownership lookups over concrete layer structure.
   *
   * The computed tracks the workspace signal (layer universe) and every layer
   * state cell it reads, so structural changes invalidate it automatically and
   * the index rebuilds lazily on the next query — bulk snapshot loading never
   * pays for indexing.
   */
  readonly #glyphObjectIndexCell: Signal<GlyphObjectIndex> = computed(
    () => this.#buildGlyphObjectIndex(),
    { name: "fontStore.glyphObjectIndex" },
  );

  readonly #layerStateCells = new Map<LayerId, WritableSignal<GlyphLayerState | null>>();
  /** Bumped when a layer state cell is created, so derivations over the cell set re-track. */
  readonly #layerCellSetVersion = signal(0, { name: "fontStore.layerCellSet" });
  /** Committed record lookups, replaced whole with each workspace or font snapshot. */
  readonly #indexCell = signal<FontRecordIndex>(EMPTY_RECORD_INDEX, {
    name: "fontStore.recordIndex",
  });
  /**
   * One cell per glyph id that has been looked up or loaded. A lookup that
   * misses subscribes only to its own glyph, so loading one glyph reruns only
   * that glyph's readers and costs O(1).
   */
  readonly #glyphCells = new Map<GlyphId, WritableSignal<Glyph | null>>();

  readonly #projectionCells = new Map<GlyphId, WritableSignal<GlyphProjection | null>>();
  // non-reactive: interning table that dedupes projection bases; only read while interning
  readonly #interpolationBases = new Map<string, InterpolationBasis>();

  constructor({
    font = null,
    records = [],
    workspace = null,
    engine = null,
  }: FontStoreOptions = {}) {
    this.#engine = engine;
    this.#font = signal(font ?? (workspace ? fontSnapshotFromWorkspace(workspace) : null), {
      name: "fontStore.font",
    });
    this.#workspace = signal(workspace, { name: "fontStore.workspace" });
    this.#committedRevision = signal(0, { name: "fontStore.committedRevision" });
    this.#invalidGlyphs = signal<GlyphInvalidation>(
      { glyphIds: null },
      { name: "fontStore.invalidGlyphs" },
    );
    if (workspace) {
      this.#indexCell.set(workspaceRecordIndex(workspace));
    } else if (font) {
      this.#indexCell.set(fontRecordIndex(font, records));
    }

    // Echoes rebuild the font snapshot but keep its kerning reference unless
    // kerning changed, so the groups are indexed again only then.
    const kerningSnapshot = computed(() => this.#font.value?.kerning ?? null, {
      name: "fontStore.kerningSnapshot",
    });
    const kerningRecords = computed(() => KerningRecords.from(kerningSnapshot.value), {
      name: "fontStore.kerningRecords",
    });
    this.#kerning = computed(
      () => {
        if (engine) track(engine.kerningRevisionCell);
        return new Kerning(kerningRecords.value, engine);
      },
      { name: "fontStore.kerning" },
    );
  }

  /**
   * The font's kerning: its records as the window's engine left them, and
   * pair reads answered by the engine, an open edit included. A new value
   * whenever either may have changed.
   */
  get kerningCell(): Signal<Kerning> {
    return this.#kerning;
  }

  /** The window's editing engine, which answers kerning and metric reads; null without one. */
  get engine(): FontEngine | null {
    return this.#engine;
  }

  get fontCell(): Signal<FontSnapshot | null> {
    return this.#font;
  }

  get workspaceCell(): Signal<WorkspaceSnapshot | null> {
    return this.#workspace;
  }

  /** Lightweight dependency for every committed native font change. */
  get committedRevisionCell(): Signal<number> {
    return this.#committedRevision;
  }

  /** Glyph roots whose resident atlas entries no longer match the committed font. */
  get invalidGlyphsCell(): Signal<GlyphInvalidation> {
    return this.#invalidGlyphs;
  }

  /** Returns the glyph that owns a layer, from the glyph directory; the glyph need not be loaded. */
  glyphIdForLayer(layerId: LayerId): GlyphId | null {
    return this.#indexCell.peek().glyphByLayer.get(layerId);
  }

  /** The layer `glyphId` authors in `sourceId`, or `null` when it has none. */
  layerIdForGlyphSource(glyphId: GlyphId, sourceId: SourceId): LayerId | null {
    return this.#indexCell.peek().layerByGlyphSource.get(glyphSourceKey(glyphId, sourceId));
  }

  layerIdForPoint(pointId: PointId): LayerId | null {
    return this.#glyphObjectIndexCell.peek().layerIdByPointId.get(pointId);
  }

  contourIdForPoint(pointId: PointId): ContourId | null {
    return this.#glyphObjectIndexCell.peek().contourIdByPointId.get(pointId);
  }

  layerIdForAnchor(anchorId: AnchorId): LayerId | null {
    return this.#glyphObjectIndexCell.peek().layerIdByAnchorId.get(anchorId);
  }

  layerIdForContour(contourId: ContourId): LayerId | null {
    return this.#glyphObjectIndexCell.peek().layerIdByContourId.get(contourId);
  }

  layerIdForSegment(segmentId: SegmentId): LayerId | null {
    return this.#glyphObjectIndexCell.peek().layerIdBySegmentId.get(segmentId);
  }

  contourIdForSegment(segmentId: SegmentId): ContourId | null {
    return this.#glyphObjectIndexCell.peek().contourIdBySegmentId.get(segmentId);
  }

  pointIdsForSegment(segmentId: SegmentId): readonly PointId[] | null {
    return this.#glyphObjectIndexCell.peek().pointIdsBySegmentId.get(segmentId);
  }

  replaceWorkspace(snapshot: WorkspaceSnapshot | null): void {
    batch(() => {
      this.#indexCell.set(workspaceRecordIndex(snapshot));
      this.#font.set(snapshot ? fontSnapshotFromWorkspace(snapshot) : null);
      this.#workspace.set(snapshot);
      this.#clearLayerStates();
      this.#clearProjections();
      this.#interpolationBases.clear();
      this.#clearGlyphs();
    });
    this.#invalidGlyphs.set({ glyphIds: null });
    this.#committedRevision.update((revision) => revision + 1);
  }

  replaceFont(snapshot: FontSnapshot): void {
    batch(() => {
      this.#indexCell.set(fontRecordIndex(snapshot));
      this.#font.set(snapshot);
      this.#workspace.set(null);
      this.#clearLayerStates();
      this.#clearProjections();
      this.#interpolationBases.clear();
      this.#clearGlyphs();
    });
    this.#invalidGlyphs.set({ glyphIds: null });
    this.#committedRevision.update((revision) => revision + 1);
  }

  applyGlyphSnapshots(snapshots: readonly GlyphSnapshot[]): void {
    batch(() => {
      for (const snapshot of snapshots) {
        if (!this.#indexCell.peek().glyphById.has(snapshot.glyphId)) continue;

        this.#projectionCell(snapshot.glyphId).set(
          snapshot.projection ? this.#internProjection(snapshot.projection) : null,
        );

        for (const layer of snapshot.layers) {
          this.#applyLayerSnapshot(layer);
        }
      }
    });
  }

  applyGlyphProjections(projections: readonly GlyphProjection[]): void {
    batch(() => {
      for (const projection of projections) {
        if (!this.#indexCell.peek().glyphById.has(projection.glyphId)) continue;
        this.#projectionCell(projection.glyphId).set(this.#internProjection(projection));
      }
    });
  }

  /**
   * Replaces a requested projection set after a structural workspace change.
   *
   * @remarks
   * The replacement is published in one signal batch. A requested glyph that
   * no longer has an authored shape resolves to `null`; additional component
   * projections returned by the bridge are retained too.
   *
   * @param glyphIds - Root glyph identities included in the native refresh.
   * @param projections - Refreshed roots and their transitive component projections.
   */
  replaceGlyphProjections(
    glyphIds: readonly GlyphId[],
    projections: readonly GlyphProjection[],
  ): void {
    const interned = projections.map((projection) => this.#internProjection(projection));
    const byGlyphId = new Map(interned.map((projection) => [projection.glyphId, projection]));

    batch(() => {
      for (const glyphId of glyphIds) {
        this.#projectionCell(glyphId).set(byGlyphId.get(glyphId) ?? null);
      }
      for (const projection of interned) {
        if (!this.#indexCell.peek().glyphById.has(projection.glyphId)) continue;
        this.#projectionCell(projection.glyphId).set(projection);
      }
    });
  }

  /**
   * Shows what the window's engine did for an edit: the font-level records it
   * changed and the layers it touched.
   *
   * @returns The resident layers' states before, to restore if the edit is undone locally.
   */
  applyEngineEdit(edit: EngineEdit): GlyphState[] {
    return batch(() => {
      if (edit.next) this.#applyRecords(edit.next);
      return this.publishLayers(edit.layers);
    });
  }

  /** The font-level records as they stand, for {@link restoreRecords}; copies nothing. */
  recordsCheckpoint(): WorkspaceSnapshot | null {
    return this.#workspace.peek();
  }

  /** Shows the font-level records of `checkpoint` again: a local edit was taken back. */
  restoreRecords(checkpoint: WorkspaceSnapshot | null): void {
    if (!checkpoint || checkpoint === this.#workspace.peek()) return;
    batch(() => {
      this.#indexCell.set(workspaceRecordIndex(checkpoint));
      this.#font.set(fontSnapshotFromWorkspace(checkpoint));
      this.#workspace.set(checkpoint);
      this.#interpolationBases.clear();
    });
  }

  /**
   * Shows each resident layer as `states` leave it; a state with no structure
   * changed only values.
   *
   * @returns Each shown layer's state before, for taking the edit back.
   */
  publishLayers(states: readonly LayerUpdate[]): GlyphState[] {
    const before: GlyphState[] = [];
    batch(() => {
      for (const state of states) {
        const layer = this.#peekLayerState(state.layerId);
        if (!layer) continue;
        before.push(layer.state);
        layer.replace(state);
      }
    });
    return before;
  }

  /**
   * Confirms an edit the window's engine made and showed, from the workspace's
   * receipt. The engine already showed the layers it touched and the
   * font-level records it changed, so only glyph records, which the workspace
   * alone builds, and layers that had no state to show come from the receipt.
   *
   * @returns The resident glyphs whose projections need rebuilding natively.
   */
  confirmEdit(applied: AppliedChange): readonly GlyphId[] {
    const current = this.#workspace.peek();
    if (!current) return [];
    const next = applied.next;
    const glyphChanges = next?.glyphChanges;
    const glyphsWithNewLayers = glyphChanges
      ? glyphIdsWithChangedLayers(this.#indexCell.peek().recordsById, glyphChanges)
      : [];
    const restructured = new Set(glyphsWithNewLayers);
    const invalid = new Set<GlyphId>([...glyphsWithNewLayers, ...applied.dependents]);
    const { glyphByLayer } = this.#indexCell.peek();
    for (const layer of applied.layers) {
      const glyphId = glyphByLayer.get(layer.layerId);
      if (!glyphId) continue;
      invalid.add(glyphId);
      if (layer.structure) restructured.add(glyphId);
    }

    batch(() => {
      if (glyphChanges) {
        this.#applyRecords({}, withGlyphRecordChanges(current.glyphs, glyphChanges));
      }
      this.#showUnshownLayers(applied.layers);
    });

    const topologyChanged = Boolean(next?.axes || next?.sources || next?.axisMappingBases);
    if (topologyChanged) this.#invalidGlyphs.set({ glyphIds: null });
    else if (invalid.size > 0) this.#invalidGlyphs.set({ glyphIds: [...invalid] });
    this.#committedRevision.update((revision) => revision + 1);

    if (topologyChanged) return this.#residentProjectionGlyphIds();
    const { glyphById } = this.#indexCell.peek();
    return [...restructured].filter(
      (glyphId) => glyphById.has(glyphId) && Boolean(this.#projectionCells.get(glyphId)?.peek()),
    );
  }

  /** Shows each of `layers` that has a structure but no state yet, so the engine never showed it. */
  #showUnshownLayers(layers: readonly LayerReplaced[]): void {
    const { glyphByLayer } = this.#indexCell.peek();
    for (const { layerId, structure, values } of layers) {
      if (!structure || !glyphByLayer.has(layerId) || this.#peekLayerState(layerId)) continue;
      this.#replaceLayerState({ layerId, structure, values });
    }
  }

  /**
   * Folds `next`'s font-level records into the workspace and drops what they
   * removed; `glyphs`, when given, is the whole glyph record list.
   */
  #applyRecords(next: FontReplacement, glyphs: GlyphRecord[] | null = null): void {
    const current = this.#workspace.peek();
    if (!current) return;
    const interpolation = next.sourceMetricsInterpolation;
    const languages = next.languages;
    const nextWorkspace: WorkspaceSnapshot = {
      ...current,
      metadata: next.metadata ?? current.metadata,
      glyphs: glyphs ?? current.glyphs,
      axes: next.axes ?? current.axes,
      axisMappings: next.axisMappings ?? current.axisMappings,
      axisMappingBases: next.axisMappingBases ?? current.axisMappingBases,
      metricDefinitions: next.metricDefinitions ?? current.metricDefinitions,
      sourceMetricsInterpolation: interpolation
        ? (interpolation.snapshot ?? null)
        : current.sourceMetricsInterpolation,
      namedInstances: next.namedInstances ?? current.namedInstances,
      languageIds: languages ? (languages.languageIds ?? null) : current.languageIds,
      sources: next.sources ?? current.sources,
      kerning: next.kerning ?? current.kerning,
    };
    this.#indexCell.set(workspaceRecordIndex(nextWorkspace));
    this.#font.set(fontSnapshotFromWorkspace(nextWorkspace));
    this.#workspace.set(nextWorkspace);

    const index = this.#indexCell.peek();
    for (const [glyphId, cell] of this.#glyphCells) {
      if (index.glyphById.has(glyphId)) continue;

      cell.set(null);
      this.#glyphCells.delete(glyphId);
    }
    if (next.axes || next.sources || next.axisMappingBases) this.#interpolationBases.clear();

    for (const [layerId, cell] of this.#layerStateCells) {
      if (index.glyphByLayer.has(layerId)) continue;

      cell.set(null);
      this.#layerStateCells.delete(layerId);
    }

    for (const [glyphId, cell] of this.#projectionCells) {
      if (index.glyphById.has(glyphId)) continue;

      cell.set(null);
      this.#projectionCells.delete(glyphId);
    }
  }

  layerState(layerId: LayerId): GlyphLayerState | null {
    return this.#layerStateCell(layerId).peek();
  }

  layerStateCell(layerId: LayerId): Signal<GlyphLayerState | null> {
    return this.#layerStateCell(layerId);
  }

  hasGlyph(glyphId: GlyphId): boolean {
    track(this.#indexCell);
    return this.#indexCell.peek().glyphById.has(glyphId);
  }

  entryForId(glyphId: GlyphId): GlyphEntry | null {
    track(this.#indexCell);
    return this.#indexCell.peek().glyphById.get(glyphId);
  }

  recordForId(glyphId: GlyphId): GlyphRecord | null {
    track(this.#indexCell);
    return this.#indexCell.peek().recordsById.get(glyphId);
  }

  records(): readonly GlyphRecord[] {
    track(this.#indexCell);
    return this.#indexCell.peek().records;
  }

  /** Every committed glyph relation, replaced whole with each snapshot. */
  get recordIndexCell(): Signal<FontRecordIndex> {
    return this.#indexCell;
  }

  projection(glyphId: GlyphId): GlyphProjection | null {
    return this.#projectionCell(glyphId).peek();
  }

  projectionCell(glyphId: GlyphId): Signal<GlyphProjection | null> {
    return this.#projectionCell(glyphId);
  }

  /**
   * Returns the loaded glyph model for a committed glyph.
   *
   * @remarks
   * Tracks residency, so a computed or render effect that finds no model reruns
   * when {@link FontStore.setGlyphs} loads it.
   *
   * @param glyphId - Committed glyph identity to resolve.
   * @returns The loaded model, or `null` while the glyph is not loaded.
   */
  glyphForId(glyphId: GlyphId): Glyph | null {
    const cell = this.#glyphCell(glyphId);
    track(cell);
    return cell.peek();
  }

  /** Snapshot of the loaded glyph models, without subscribing to future loads. */
  loadedGlyphs(): Glyph[] {
    const glyphs: Glyph[] = [];
    for (const cell of this.#glyphCells.values()) {
      const glyph = cell.peek();
      if (glyph) glyphs.push(glyph);
    }
    return glyphs;
  }

  setGlyphs(glyphs: readonly Glyph[]): void {
    const { glyphById } = this.#indexCell.peek();
    batch(() => {
      for (const glyph of glyphs) {
        if (!glyphById.has(glyph.id)) continue;

        const cell = this.#glyphCell(glyph.id);
        if (!cell.peek()) cell.set(glyph);
      }
    });
  }

  componentBaseGlyphIdsInLayerState(glyphId: GlyphId): readonly GlyphId[] {
    const baseGlyphIds = new Set<GlyphId>();
    for (const state of this.#loadedLayerStatesForGlyph(glyphId)) {
      for (const baseGlyphId of componentBaseGlyphIds(state.structure)) {
        baseGlyphIds.add(baseGlyphId);
      }
    }
    return [...baseGlyphIds];
  }

  #applyLayerSnapshot(snapshot: WorkspaceGlyphLayerSnapshot): boolean {
    const layerId = this.#indexCell
      .peek()
      .layerByGlyphSource.get(glyphSourceKey(snapshot.glyphId, snapshot.sourceId));
    if (layerId !== snapshot.state.layerId) return false;

    this.#replaceLayerState(snapshot.state);
    return true;
  }

  #replaceLayerState(state: GlyphState): GlyphLayerState {
    const cell = this.#layerStateCell(state.layerId);
    const existing = cell.peek();
    if (existing) {
      existing.replace(state);
      return existing;
    }

    const created = new GlyphLayerState(state);
    cell.set(created);
    return created;
  }

  #loadedLayerStatesForGlyph(glyphId: GlyphId): GlyphLayerState[] {
    const workspace = this.#workspace.peek();
    const record = workspace?.glyphs.find((candidate) => candidate.id === glyphId);
    if (!record) return [];

    return record.layers
      .map((layer) => this.#peekLayerState(layer.id))
      .filter((state): state is GlyphLayerState => state !== null);
  }

  #layerStateCell(layerId: LayerId): WritableSignal<GlyphLayerState | null> {
    let cell = this.#layerStateCells.get(layerId);
    if (!cell) {
      cell = signal(null, { name: `fontStore.layerState.${layerId}` });
      this.#layerStateCells.set(layerId, cell);
      this.#layerCellSetVersion.set(this.#layerCellSetVersion.peek() + 1);
    }
    return cell;
  }

  #peekLayerState(layerId: LayerId): GlyphLayerState | null {
    return this.#layerStateCells.get(layerId)?.peek() ?? null;
  }

  #clearLayerStates(): void {
    for (const cell of this.#layerStateCells.values()) cell.set(null);
    this.#layerStateCells.clear();
  }

  #projectionCell(glyphId: GlyphId): WritableSignal<GlyphProjection | null> {
    let cell = this.#projectionCells.get(glyphId);
    if (!cell) {
      cell = signal(null, { name: `fontStore.projection.${glyphId}` });
      this.#projectionCells.set(glyphId, cell);
    }
    return cell;
  }

  #glyphCell(glyphId: GlyphId): WritableSignal<Glyph | null> {
    let cell = this.#glyphCells.get(glyphId);
    if (!cell) {
      cell = signal(null, { name: `fontStore.glyph.${glyphId}` });
      this.#glyphCells.set(glyphId, cell);
    }
    return cell;
  }

  #clearGlyphs(): void {
    for (const cell of this.#glyphCells.values()) cell.set(null);
    this.#glyphCells.clear();
  }

  #clearProjections(): void {
    for (const cell of this.#projectionCells.values()) cell.set(null);
    this.#projectionCells.clear();
  }

  #residentProjectionGlyphIds(): GlyphId[] {
    const glyphIds: GlyphId[] = [];
    for (const [glyphId, cell] of this.#projectionCells) {
      if (cell.peek()) glyphIds.push(glyphId);
    }
    return glyphIds;
  }

  #internProjection(projection: GlyphProjection): GlyphProjection {
    const interpolation = projection.interpolation;
    if (!interpolation) return projection;

    const key = interpolation.basis.sourceIds.join("\u0000");
    const basis = this.#interpolationBases.get(key);
    if (!basis) {
      this.#interpolationBases.set(key, interpolation.basis);
      return projection;
    }
    if (basis === interpolation.basis) return projection;

    return {
      ...projection,
      interpolation: { ...interpolation, basis },
    };
  }

  #buildGlyphObjectIndex(): GlyphObjectIndex {
    // Layer state cells materialize lazily, so the cell-set version is what
    // lets cells created after the last rebuild enter the tracked set.
    track(this.#layerCellSetVersion);
    const layerIdByPointId = new EntityMap<PointId, LayerId>("point layer");
    const contourIdByPointId = new EntityMap<PointId, ContourId>("point contour");
    const layerIdByContourId = new EntityMap<ContourId, LayerId>("contour layer");
    const layerIdByAnchorId = new EntityMap<AnchorId, LayerId>("anchor layer");
    const layerIdBySegmentId = new EntityMap<SegmentId, LayerId>("segment layer");
    const contourIdBySegmentId = new EntityMap<SegmentId, ContourId>("segment contour");
    const pointIdsBySegmentId = new EntityMap<SegmentId, readonly PointId[]>("segment points");

    for (const cell of this.#layerStateCells.values()) {
      track(cell);
      const state = cell.peek();
      if (!state) continue;

      const layerId = state.layerId;
      track(state.structureCell);
      const structure = state.structure;

      for (const contour of structure.contours) {
        layerIdByContourId.set(contour.id, layerId);

        for (const point of contour.points) {
          layerIdByPointId.set(point.id, layerId);
          contourIdByPointId.set(point.id, contour.id);
        }

        for (const segment of indexedSegments(contour)) {
          layerIdBySegmentId.set(segment.id, layerId);
          contourIdBySegmentId.set(segment.id, contour.id);
          pointIdsBySegmentId.set(segment.id, segment.pointIds);
        }
      }

      for (const anchor of structure.anchors) {
        layerIdByAnchorId.set(anchor.id, layerId);
      }
    }

    return {
      layerIdByPointId,
      contourIdByPointId,
      layerIdByContourId,
      layerIdByAnchorId,
      layerIdBySegmentId,
      contourIdBySegmentId,
      pointIdsBySegmentId,
    };
  }
}

const EMPTY_RECORD_INDEX: FontRecordIndex = recordIndex([], []);

function workspaceRecordIndex(snapshot: WorkspaceSnapshot | null): FontRecordIndex {
  return snapshot
    ? recordIndex(snapshot.glyphs.map(glyphEntry), snapshot.glyphs)
    : EMPTY_RECORD_INDEX;
}

function fontRecordIndex(
  snapshot: FontSnapshot,
  records: readonly GlyphRecord[] = [],
): FontRecordIndex {
  return recordIndex(snapshot.glyphs, records);
}

/** Indexes directory entries and the records of those glyphs; records of unknown glyphs are dropped. */
function recordIndex(
  entries: readonly GlyphEntry[],
  records: readonly GlyphRecord[],
): FontRecordIndex {
  const glyphById = new EntityMap<GlyphId, GlyphEntry>("glyph");
  const entryByName = new EntityMap<GlyphName, GlyphEntry>("glyph name");
  const nameByUnicode = new Map<Unicode, GlyphName>();
  for (const entry of entries) {
    glyphById.set(entry.id, entry);
    entryByName.set(entry.name, entry);
    for (const unicode of entry.unicodes) {
      if (!nameByUnicode.has(unicode)) nameByUnicode.set(unicode, entry.name);
    }
  }

  const knownRecords = records.filter((record) => glyphById.has(record.id));
  const recordsById = new EntityMap<GlyphId, GlyphRecord>("glyph record");
  const recordByName = new EntityMap<GlyphName, GlyphRecord>("glyph record name");
  const dependentsById = new Map<GlyphId, Set<GlyphId>>();
  const layerByGlyphSource = new EntityMap<GlyphSourceKey, LayerId>("glyph source layer");
  const glyphByLayer = new EntityMap<LayerId, GlyphId>("layer glyph");
  for (const record of knownRecords) {
    recordsById.set(record.id, record);
    recordByName.set(record.name, record);
    for (const baseId of record.componentBaseGlyphIds) {
      let dependents = dependentsById.get(baseId);
      if (!dependents) {
        dependents = new Set();
        dependentsById.set(baseId, dependents);
      }
      dependents.add(record.id);
    }
    for (const layer of record.layers) {
      layerByGlyphSource.set(glyphSourceKey(record.id, layer.sourceId), layer.id);
      glyphByLayer.set(layer.id, record.id);
    }
  }

  return {
    entries: [...entries],
    records: knownRecords,
    unicodes: nameByUnicode.keys().toArray().sort(ascending),
    glyphById,
    recordsById,
    entryByName,
    recordByName,
    nameByUnicode,
    dependentsById,
    layerByGlyphSource,
    glyphByLayer,
  };
}

function glyphSourceKey(glyphId: GlyphId, sourceId: SourceId): GlyphSourceKey {
  return `${glyphId}:${sourceId}` as GlyphSourceKey;
}

/** The glyphs `changes` gave new or different layers, or removed. */
function glyphIdsWithChangedLayers(
  before: ReadonlyEntityMap<GlyphId, GlyphRecord>,
  changes: GlyphRecordChanges,
): GlyphId[] {
  const changed = changes.updated
    .filter((glyph) => {
      const previous = before.get(glyph.id);
      return !previous || !sameGlyphLayers(previous, glyph);
    })
    .map((glyph) => glyph.id);
  return [...changed, ...changes.removed];
}

/** Glyph records in the workspace's order, by name as Rust orders it. */
const byRecordName = comparing((record: GlyphRecord) => record.name, byCodePoint);

/**
 * `records`, in the workspace's name order, with `changes` applied: each
 * changed record takes its place by name, and removed glyphs leave.
 */
function withGlyphRecordChanges(
  records: readonly GlyphRecord[],
  changes: GlyphRecordChanges,
): GlyphRecord[] {
  const leaving = new Set<GlyphId>([
    ...changes.removed,
    ...changes.updated.map((record) => record.id),
  ]);
  const kept = records.filter((record) => !leaving.has(record.id));
  const joining = changes.updated.toSorted(byRecordName);

  // Both lists are in name order, so one pass merges them.
  const merged: GlyphRecord[] = [];
  let next = 0;
  for (const record of kept) {
    while (next < joining.length && byRecordName(joining[next]!, record) < 0) {
      merged.push(joining[next++]!);
    }
    merged.push(record);
  }
  merged.push(...joining.slice(next));
  return merged;
}

function sameGlyphLayers(left: GlyphRecord, right: GlyphRecord): boolean {
  if (left.layers.length !== right.layers.length) return false;

  return left.layers.every((layer, index) => {
    const other = right.layers[index];
    return other?.id === layer.id && other.sourceId === layer.sourceId;
  });
}

function componentBaseGlyphIds(structure: GlyphStructure): readonly GlyphId[] {
  return structure.components.map((component) => component.baseGlyphId);
}

function indexedSegments(contour: ContourData): GlyphObjectSegment[] {
  const { points, closed } = contour;
  if (points.length < 2) return [];

  const segments: GlyphObjectSegment[] = [];
  let index = 0;

  const limit = closed ? points.length : points.length - 1;

  while (index < limit) {
    const start = pointAt(points, closed, index);
    const next = pointAt(points, closed, index + 1);
    if (!start || !next) break;

    if (isOnCurve(start) && isOnCurve(next)) {
      segments.push(indexedSegment(start, next, [start.id, next.id]));
      index += 1;
      continue;
    }

    if (isOnCurve(start) && isOffCurve(next)) {
      const maybeEnd = pointAt(points, closed, index + 2);
      if (!maybeEnd) break;

      if (isOnCurve(maybeEnd)) {
        segments.push(indexedSegment(start, maybeEnd, [start.id, next.id, maybeEnd.id]));
        index += 2;
        continue;
      }

      if (isOffCurve(maybeEnd)) {
        const end = pointAt(points, closed, index + 3);
        if (!end) break;

        segments.push(indexedSegment(start, end, [start.id, next.id, maybeEnd.id, end.id]));
        index += 3;
        continue;
      }
    }

    index += 1;
  }

  return segments;
}

function indexedSegment(
  start: PointData,
  end: PointData,
  pointIds: readonly PointId[],
): GlyphObjectSegment {
  return {
    id: segmentIdFor(start.id, end.id),
    pointIds,
  };
}

function pointAt(points: readonly PointData[], closed: boolean, index: number): PointData | null {
  if (index < points.length) return points[index] ?? null;
  if (!closed) return null;

  return points[index - points.length] ?? null;
}

function isOnCurve(point: PointData): boolean {
  return Validate.isOnCurve(point);
}

function isOffCurve(point: PointData): boolean {
  return Validate.isOffCurve(point);
}

function glyphEntry(record: GlyphRecord): GlyphEntry {
  return {
    id: record.id,
    name: record.name,
    unicodes: [...record.unicodes],
  };
}

function fontSnapshotFromWorkspace(workspace: WorkspaceSnapshot): FontSnapshot {
  return {
    metadata: workspace.metadata,
    metrics: workspace.metrics,
    metricDefinitions: workspace.metricDefinitions,
    // oxlint-disable-next-line shift/no-conditional-spread -- FontSnapshot is a stored snapshot; a font without interpolated source metrics has no key
    ...(workspace.sourceMetricsInterpolation
      ? { sourceMetricsInterpolation: workspace.sourceMetricsInterpolation }
      : {}),
    glyphs: workspace.glyphs.map(glyphEntry),
    sources: workspace.sources,
    axes: workspace.axes,
    axisMappings: workspace.axisMappings,
    axisMappingBases: workspace.axisMappingBases,
    namedInstances: workspace.namedInstances,
    // oxlint-disable-next-line shift/no-conditional-spread -- FontSnapshot is a stored snapshot; a font without language ids has no key
    ...(workspace.languageIds ? { languageIds: workspace.languageIds } : {}),
    kerning: workspace.kerning,
  };
}
