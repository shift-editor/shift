import type {
  AppliedChange,
  AnchorId,
  ContourData,
  ContourId,
  FontSnapshot,
  GlyphEntry,
  GlyphId,
  GlyphProjection,
  GlyphRecord,
  GlyphSnapshot,
  GlyphStructure,
  GlyphState,
  InterpolationBasis,
  LayerId,
  PointData,
  PointId,
  SourceId,
  WorkspaceGlyphLayerSnapshot,
  WorkspaceSnapshot,
} from "@shift/types";
import { segmentIdFor, type SegmentId } from "@shift/glyph-state";
import { Validate } from "@shift/validation";
import {
  batch,
  computed,
  signal,
  track,
  type Signal,
  type WritableSignal,
} from "../signals/signal";
import type { PendingEditId } from "../../types/editing";
import type { FontRecordIndex, FontStoreOptions, GlyphSourceKey } from "../../types/font";
import type { GlyphObjectIndex, GlyphObjectSegment } from "../../types/glyph";
import { GlyphLayerState } from "./GlyphLayerState";
import type { Glyph } from "./Glyph";

/**
 * Renderer-local owner for font records, concrete glyph layer state, glyphs, and views.
 *
 * Workspace mutation and async read ordering are owned by
 * `WorkspaceEditCoordinator`. This store materializes returned glyph snapshots
 * into layer state and indexes objects from that concrete state.
 */
export class FontStore {
  readonly #font: WritableSignal<FontSnapshot | null>;
  readonly #workspace: WritableSignal<WorkspaceSnapshot | null>;
  readonly #committedFont: WritableSignal<FontStore>;
  readonly #invalidGlyphIds: WritableSignal<readonly GlyphId[] | null>;

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
  /** Loaded glyph models; replaced whole so lookups that missed rerun once a glyph loads. */
  readonly #glyphsCell = signal<ReadonlyMap<GlyphId, Glyph>>(new Map(), {
    name: "fontStore.glyphs",
  });

  readonly #projectionCells = new Map<GlyphId, WritableSignal<GlyphProjection | null>>();
  // non-reactive: interning table that dedupes projection bases; only read while interning
  readonly #interpolationBases = new Map<string, InterpolationBasis>();

  constructor({ font = null, records = [], workspace = null }: FontStoreOptions = {}) {
    this.#font = signal(font ?? (workspace ? fontSnapshotFromWorkspace(workspace) : null), {
      name: "fontStore.font",
    });
    this.#workspace = signal(workspace, { name: "fontStore.workspace" });
    this.#committedFont = signal(this, {
      name: "fontStore.committedFont",
      // The store is a stable mutable font owner; every committed write invalidates dependents.
      equals: () => false,
    });
    this.#invalidGlyphIds = signal<readonly GlyphId[] | null>(null, {
      name: "fontStore.invalidGlyphIds",
      equals: () => false,
    });
    if (workspace) {
      this.#indexCell.set(workspaceRecordIndex(workspace));
    } else if (font) {
      this.#indexCell.set(fontRecordIndex(font, records));
    }
  }

  get fontCell(): Signal<FontSnapshot | null> {
    return this.#font;
  }

  get workspaceCell(): Signal<WorkspaceSnapshot | null> {
    return this.#workspace;
  }

  /** Lightweight dependency for every committed native font change. */
  get committedFontCell(): Signal<FontStore> {
    return this.#committedFont;
  }

  /** Glyph roots whose resident atlas entries no longer match the committed font. */
  get invalidGlyphIdsCell(): Signal<readonly GlyphId[] | null> {
    return this.#invalidGlyphIds;
  }

  layerIdForPoint(pointId: PointId): LayerId | null {
    return this.#glyphObjectIndexCell.peek().layerIdByPointId.get(pointId) ?? null;
  }

  contourIdForPoint(pointId: PointId): ContourId | null {
    return this.#glyphObjectIndexCell.peek().contourIdByPointId.get(pointId) ?? null;
  }

  layerIdForAnchor(anchorId: AnchorId): LayerId | null {
    return this.#glyphObjectIndexCell.peek().layerIdByAnchorId.get(anchorId) ?? null;
  }

  layerIdForContour(contourId: ContourId): LayerId | null {
    return this.#glyphObjectIndexCell.peek().layerIdByContourId.get(contourId) ?? null;
  }

  layerIdForSegment(segmentId: SegmentId): LayerId | null {
    return this.#glyphObjectIndexCell.peek().layerIdBySegmentId.get(segmentId) ?? null;
  }

  contourIdForSegment(segmentId: SegmentId): ContourId | null {
    return this.#glyphObjectIndexCell.peek().contourIdBySegmentId.get(segmentId) ?? null;
  }

  pointIdsForSegment(segmentId: SegmentId): readonly PointId[] | null {
    return this.#glyphObjectIndexCell.peek().pointIdsBySegmentId.get(segmentId) ?? null;
  }

  replaceWorkspace(snapshot: WorkspaceSnapshot | null): void {
    batch(() => {
      this.#indexCell.set(workspaceRecordIndex(snapshot));
      this.#font.set(snapshot ? fontSnapshotFromWorkspace(snapshot) : null);
      this.#workspace.set(snapshot);
      this.#clearLayerStates();
      this.#clearProjections();
      this.#interpolationBases.clear();
      this.#glyphsCell.set(new Map());
    });
    this.#invalidGlyphIds.set(null);
    this.#committedFont.set(this);
  }

  replaceFont(snapshot: FontSnapshot): void {
    batch(() => {
      this.#indexCell.set(fontRecordIndex(snapshot));
      this.#font.set(snapshot);
      this.#workspace.set(null);
      this.#clearLayerStates();
      this.#clearProjections();
      this.#interpolationBases.clear();
      this.#glyphsCell.set(new Map());
    });
    this.#invalidGlyphIds.set(null);
    this.#committedFont.set(this);
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

  /** Restores every loaded layer touched by a throwing renderer transaction. */
  rollbackEdit(editId: PendingEditId): void {
    for (const cell of this.#layerStateCells.values()) {
      cell.peek()?.rollbackEdit(editId);
    }
  }

  /** Confirms a renderer-tracked edit and folds its replace-grade workspace echo. */
  confirmEdit(editId: PendingEditId, applied: AppliedChange): readonly GlyphId[] {
    return this.#foldWorkspaceChange(applied, editId);
  }

  /** Folds an untracked undo, redo, snapshot, or direct workspace echo. */
  applyWorkspaceChange(applied: AppliedChange): readonly GlyphId[] {
    return this.#foldWorkspaceChange(applied, null);
  }

  /**
   * Folds a replace-grade workspace echo and reports structural projection work.
   *
   * Numeric layer edits flow through live layer signals and return no projection
   * work. Axis/source topology, glyph-layer membership, and structural layer
   * replacements return only resident glyph identities that need native rebuilding.
   */
  #foldWorkspaceChange(applied: AppliedChange, editId: PendingEditId | null): readonly GlyphId[] {
    const current = this.#workspace.peek();
    if (!current) return [];
    const changedGlyphLayers = applied.next?.glyphs
      ? glyphIdsWithChangedLayers(current.glyphs, applied.next.glyphs)
      : [];
    const structurallyChangedGlyphIds = new Set(changedGlyphLayers);
    const invalidGlyphIds = new Set<GlyphId>([...changedGlyphLayers, ...applied.dependents]);
    for (const layer of applied.layers) {
      const glyphId = this.#indexCell.peek().glyphByLayer.get(layer.layerId);
      if (!glyphId) continue;

      invalidGlyphIds.add(glyphId);
      if (layer.structure) structurallyChangedGlyphIds.add(glyphId);
    }

    batch(() => {
      const next = applied.next;
      const nextWorkspace = next
        ? {
            ...current,
            metadata: next.metadata ?? current.metadata,
            glyphs: next.glyphs ?? current.glyphs,
            axes: next.axes ?? current.axes,
            axisMappings: next.axisMappings ?? current.axisMappings,
            axisMappingBases: next.axisMappingBases ?? current.axisMappingBases,
            metricDefinitions: next.metricDefinitions ?? current.metricDefinitions,
            sourceMetricsInterpolation: next.sourceMetricsInterpolation
              ? (next.sourceMetricsInterpolation.snapshot ?? null)
              : current.sourceMetricsInterpolation,
            namedInstances: next.namedInstances ?? current.namedInstances,
            languageIds: next.languages
              ? (next.languages.languageIds ?? null)
              : current.languageIds,
            sources: next.sources ?? current.sources,
          }
        : current;

      if (nextWorkspace !== current) {
        this.#indexCell.set(workspaceRecordIndex(nextWorkspace));
        this.#font.set(fontSnapshotFromWorkspace(nextWorkspace));
        this.#workspace.set(nextWorkspace);
      }

      const index = this.#indexCell.peek();
      if (nextWorkspace !== current) {
        const glyphs = this.#glyphsCell.peek();
        const residentGlyphs = [...glyphs].filter(([glyphId]) => index.glyphById.has(glyphId));
        if (residentGlyphs.length !== glyphs.size) this.#glyphsCell.set(new Map(residentGlyphs));
        if (next?.axes || next?.sources) this.#interpolationBases.clear();

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

      for (const layer of applied.layers) {
        if (!index.glyphByLayer.has(layer.layerId)) continue;

        const state = this.#peekLayerState(layer.layerId);
        if (state) {
          state.foldWorkspaceState(editId, layer);
          continue;
        }
        if (!layer.structure) continue;

        this.#replaceLayerState({
          layerId: layer.layerId,
          structure: layer.structure,
          values: layer.values,
        });
      }
    });

    if (applied.next?.axes || applied.next?.sources) {
      this.#invalidGlyphIds.set(null);
    } else if (invalidGlyphIds.size > 0) {
      this.#invalidGlyphIds.set([...invalidGlyphIds]);
    }
    this.#committedFont.set(this);

    if (applied.next?.axes || applied.next?.sources) {
      return this.#residentProjectionGlyphIds();
    }

    const { glyphById } = this.#indexCell.peek();
    return [...structurallyChangedGlyphIds].filter(
      (glyphId) => glyphById.has(glyphId) && Boolean(this.#projectionCells.get(glyphId)?.peek()),
    );
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
    return this.#indexCell.peek().glyphById.get(glyphId) ?? null;
  }

  recordForId(glyphId: GlyphId): GlyphRecord | null {
    track(this.#indexCell);
    return this.#indexCell.peek().recordsById.get(glyphId) ?? null;
  }

  records(): readonly GlyphRecord[] {
    track(this.#indexCell);
    return [...this.#indexCell.peek().recordsById.values()];
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
    track(this.#glyphsCell);
    return this.#glyphsCell.peek().get(glyphId) ?? null;
  }

  setGlyphs(glyphs: readonly Glyph[]): void {
    const { glyphById } = this.#indexCell.peek();
    const current = this.#glyphsCell.peek();
    const added = glyphs.filter((glyph) => glyphById.has(glyph.id) && !current.has(glyph.id));
    if (added.length === 0) return;

    const next = new Map(current);
    for (const glyph of added) next.set(glyph.id, glyph);
    this.#glyphsCell.set(next);
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
    const layerIdByPointId = new Map<PointId, LayerId>();
    const contourIdByPointId = new Map<PointId, ContourId>();
    const layerIdByContourId = new Map<ContourId, LayerId>();
    const layerIdByAnchorId = new Map<AnchorId, LayerId>();
    const layerIdBySegmentId = new Map<SegmentId, LayerId>();
    const contourIdBySegmentId = new Map<SegmentId, ContourId>();
    const pointIdsBySegmentId = new Map<SegmentId, readonly PointId[]>();

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

const EMPTY_RECORD_INDEX: FontRecordIndex = {
  layerByGlyphSource: new Map(),
  glyphByLayer: new Map(),
  glyphById: new Map(),
  recordsById: new Map(),
};

function workspaceRecordIndex(snapshot: WorkspaceSnapshot | null): FontRecordIndex {
  if (!snapshot) return EMPTY_RECORD_INDEX;

  const layerByGlyphSource = new Map<GlyphSourceKey, LayerId>();
  const glyphByLayer = new Map<LayerId, GlyphId>();
  const glyphById = new Map<GlyphId, GlyphEntry>();
  const recordsById = new Map<GlyphId, GlyphRecord>();
  for (const glyph of snapshot.glyphs) {
    glyphById.set(glyph.id, glyphEntry(glyph));
    recordsById.set(glyph.id, glyph);
    for (const layer of glyph.layers) {
      layerByGlyphSource.set(glyphSourceKey(glyph.id, layer.sourceId), layer.id);
      glyphByLayer.set(layer.id, glyph.id);
    }
  }

  return { layerByGlyphSource, glyphByLayer, glyphById, recordsById };
}

function fontRecordIndex(
  snapshot: FontSnapshot,
  records: readonly GlyphRecord[] = [],
): FontRecordIndex {
  const layerByGlyphSource = new Map<GlyphSourceKey, LayerId>();
  const glyphByLayer = new Map<LayerId, GlyphId>();
  const glyphById = new Map<GlyphId, GlyphEntry>();
  const recordsById = new Map<GlyphId, GlyphRecord>();
  for (const glyph of snapshot.glyphs) glyphById.set(glyph.id, glyph);

  for (const record of records) {
    if (!glyphById.has(record.id)) continue;

    recordsById.set(record.id, record);
    for (const layer of record.layers) {
      layerByGlyphSource.set(glyphSourceKey(record.id, layer.sourceId), layer.id);
      glyphByLayer.set(layer.id, record.id);
    }
  }

  return { layerByGlyphSource, glyphByLayer, glyphById, recordsById };
}

function glyphSourceKey(glyphId: GlyphId, sourceId: SourceId): GlyphSourceKey {
  return `${glyphId}:${sourceId}` as GlyphSourceKey;
}

function glyphIdsWithChangedLayers(
  before: readonly GlyphRecord[],
  after: readonly GlyphRecord[],
): GlyphId[] {
  const beforeById = new Map(before.map((glyph) => [glyph.id, glyph]));
  const changed: GlyphId[] = [];

  for (const glyph of after) {
    const previous = beforeById.get(glyph.id);
    if (!previous || !sameGlyphLayers(previous, glyph)) changed.push(glyph.id);
    beforeById.delete(glyph.id);
  }

  changed.push(...beforeById.keys());
  return changed;
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
    ...(workspace.sourceMetricsInterpolation
      ? { sourceMetricsInterpolation: workspace.sourceMetricsInterpolation }
      : {}),
    glyphs: workspace.glyphs.map(glyphEntry),
    sources: workspace.sources,
    axes: workspace.axes,
    axisMappings: workspace.axisMappings,
    axisMappingBases: workspace.axisMappingBases,
    namedInstances: workspace.namedInstances,
    ...(workspace.languageIds ? { languageIds: workspace.languageIds } : {}),
  };
}
