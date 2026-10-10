import type {
  FontMetrics,
  MetricDefinition,
  MetricKind,
  FontMetadata,
  Axis,
  AxisDefinition,
  AxisMapping,
  AxisMappingBasis,
  Source,
  GlyphEntry,
  GlyphHandle,
  GlyphId,
  GlyphLayerSnapshot,
  GlyphPreview,
  GlyphRecord,
  KerningValueEdit,
  GlyphSnapshotRequest,
  GlyphName,
  SourceId,
  Unicode,
  AxisId,
  AnchorId,
  ContourId,
  LayerId,
  LayerMatch,
  LayerRead,
  Location,
  PointId,
  SegmentId,
  NamedInstance,
  NamedInstanceDefinition,
  NamedInstanceId,
  SourceMetrics,
} from "@shift/types";
import {
  mintAxisId,
  mintGlyphId,
  mintLayerId,
  mintNamedInstanceId,
  mintSourceId,
} from "@shift/types";
import {
  batch,
  computed,
  effect,
  track,
  untracked,
  type ComputedSignal,
  type Effect,
  type Signal,
} from "../signals/signal";
import type { FontOptions, FontRecordIndex, WorkspaceEditCoordinator } from "../../types/font";
import type { GlyphReader } from "../../types/glyph";
import { Glyph, GlyphLayer } from "./Glyph";
import type { FontStore, GlyphInvalidation } from "./FontStore";
import type { GlyphLayerState } from "./GlyphLayerState";
import type { Kerning } from "./Kerning";
import { KerningEdit } from "./KerningEdit";
import { SourceMetricsInterpolation } from "./SourceMetricsInterpolation";
import {
  designAxisLocationFromLocation,
  locationFromDesignAxisLocation,
} from "../variation/location";
import { Designspace } from "../variation/Designspace";
import type { DesignAxisLocation, ExternalAxisLocation } from "../../types/variation";
import { uniqueInOrder } from "../utils/utils";
import { fallbackGlyphNameForUnicode } from "../utils/unicode";
import { createBatchRequest } from "../utils/batchRequest";

/**
 * Directory queries over the store's committed glyph index.
 *
 * @remarks
 * Holds no lookups of its own: every relation comes from `FontRecordIndex`,
 * which `FontStore` builds once per snapshot. Methods named `record*`, `has*`,
 * and dependency lookups only describe glyphs committed in the font, while
 * handle/name resolution methods may use injected glyph metadata so UI flows
 * can address glyphs before they are created.
 */
class GlyphDirectory {
  readonly #index: FontRecordIndex;
  readonly #glyphInfo: NonNullable<FontOptions["glyphInfo"]> | null;

  constructor(index: FontRecordIndex, glyphInfo: NonNullable<FontOptions["glyphInfo"]> | null) {
    this.#index = index;
    this.#glyphInfo = glyphInfo;
  }

  get entries(): readonly GlyphEntry[] {
    return this.#index.entries;
  }

  get records(): readonly GlyphRecord[] {
    return this.#index.records;
  }

  get unicodes(): readonly Unicode[] {
    return this.#index.unicodes;
  }

  /**
   * Resolves the preferred glyph name for a Unicode scalar.
   *
   * @remarks
   * Existing font mappings win. Missing codepoints use injected glyph metadata
   * when available, then fall back to a deterministic `uniXXXX`-style name.
   *
   * @param unicode - Unicode scalar value to resolve.
   * @returns A production glyph name suitable for opening or creating a glyph.
   */
  nameForUnicode(unicode: Unicode): GlyphName {
    const nameFromFont = this.#index.nameByUnicode.get(unicode);
    if (nameFromFont) return nameFromFont;

    const nameFromDatabase = this.#glyphInfo?.getGlyphName(unicode);
    if (nameFromDatabase) return nameFromDatabase;

    const fallbackName = fallbackGlyphNameForUnicode(unicode);
    return fallbackName as GlyphName;
  }

  hasGlyph(glyphId: GlyphId): boolean {
    return this.#index.glyphById.has(glyphId);
  }

  entryForName(name: GlyphName): GlyphEntry | null {
    return this.#index.entryByName.get(name) ?? null;
  }

  recordForName(name: GlyphName): GlyphRecord | null {
    return this.#index.recordByName.get(name) ?? null;
  }

  entryForId(glyphId: GlyphId): GlyphEntry | null {
    return this.#index.glyphById.get(glyphId) ?? null;
  }

  recordForId(glyphId: GlyphId): GlyphRecord | null {
    return this.#index.recordsById.get(glyphId) ?? null;
  }

  unicodesForName(name: GlyphName): readonly Unicode[] {
    return this.entryForName(name)?.unicodes ?? [];
  }

  primaryUnicodeForName(name: GlyphName): Unicode | null {
    return this.unicodesForName(name)[0] ?? null;
  }

  /** Base glyph names from the committed record; empty when absent. */
  componentBaseNamesForName(name: GlyphName): readonly GlyphName[] {
    return this.#namesFor(this.recordForName(name)?.componentBaseGlyphIds ?? []);
  }

  /** Sorted names of committed glyphs that reference this glyph as a component. */
  dependentNamesForName(name: GlyphName): readonly GlyphName[] {
    const record = this.recordForName(name);
    if (!record) return [];
    return this.#namesFor(this.#index.dependentsById.get(record.id) ?? []).sort();
  }

  /**
   * Resolves a glyph name to an editor handle.
   *
   * @remarks
   * Existing records include their committed primary Unicode. Missing glyphs
   * may still get a Unicode hint from bundled glyph metadata; otherwise the
   * handle remains name-only.
   *
   * @param name - Glyph name to address.
   * @returns A handle suitable for opening, creating, or querying glyph state.
   */
  glyphHandleForName(name: GlyphName): GlyphHandle {
    const entry = this.entryForName(name);
    const unicode = entry
      ? this.primaryUnicodeForName(name)
      : (this.#glyphInfo?.getGlyphByName(name)?.codepoint ?? null);
    return unicode === null ? { name } : { name, unicode };
  }

  #namesFor(glyphIds: Iterable<GlyphId>): GlyphName[] {
    return [...glyphIds].flatMap((glyphId) => this.#index.glyphById.get(glyphId)?.name ?? []);
  }

  /**
   * Resolves a Unicode scalar to an editor handle.
   *
   * @param unicode - Unicode scalar value to address.
   * @returns A handle with a resolved name and Unicode value.
   */
  glyphHandleForUnicode(unicode: Unicode): GlyphHandle | null {
    const name = this.nameForUnicode(unicode);
    return name ? { name, unicode } : null;
  }
}

interface ComponentGlyphs {
  readonly glyphs: ReadonlyMap<GlyphId, Glyph>;
  readonly missingGlyphIds: readonly GlyphId[];
}

const DEFAULT_FONT_METRICS: FontMetrics = {
  unitsPerEm: 1000,
};

/**
 * Reactive facade for the loaded font.
 *
 * `Font` exposes font-level metadata, source lookup, and domain editing verbs
 * over `FontStore`. Plain getters such as `metrics`, `unicodes`, and `sources`
 * return snapshots; reactive callers use the matching `*Cell` APIs.
 *
 * A glyph handle is only an identity. It may name a glyph that is not committed
 * in the font yet. Use {@link glyph} for existing glyph data, and use the
 * editor layer API when the caller intends to create or edit authored glyph data.
 *
 * @beta Embedders may use this type; its members can change between SDK minor versions.
 */
export class Font {
  readonly #loadedCell: Signal<boolean>;

  readonly #metricsCell: Signal<FontMetrics>;
  readonly #metricDefinitionsCell: Signal<MetricDefinition[]>;

  readonly #sourceMetricsInterpolationCell: Signal<SourceMetricsInterpolation | null>;
  readonly #kerningCell: Signal<Kerning>;
  readonly #defaultSourceMetricsCell: Signal<SourceMetrics>;

  readonly #metadataCell: Signal<FontMetadata>;
  readonly #sourcesCell: Signal<Source[]>;

  readonly #axesCell: Signal<Axis[]>;
  readonly #axisMappingsCell: Signal<AxisMapping[]>;
  readonly #axisMappingBasesCell: Signal<AxisMappingBasis[]>;
  readonly #designspace: Designspace;

  readonly #namedInstancesCell: Signal<NamedInstance[]>;
  readonly #languageIdsCell: Signal<readonly string[] | null>;

  readonly #unicodesCell: Signal<Unicode[]>;
  readonly #glyphEntriesCell: Signal<readonly GlyphEntry[]>;
  readonly #glyphRecordsCell: Signal<readonly GlyphRecord[]>;
  readonly #directoryCell: Signal<GlyphDirectory>;

  readonly #glyphRequests = createBatchRequest<GlyphId>((glyphIds) =>
    this.#readGlyphsIntoStore(glyphIds),
  );
  readonly #store: FontStore;
  readonly #glyphInfo: NonNullable<FontOptions["glyphInfo"]> | null;
  readonly #reader: GlyphReader | null;
  readonly #editCoordinator: NonNullable<FontOptions["editCoordinator"]> | null;
  readonly #glyphsEffect: Effect;

  /**
   * Builds a font model over renderer-local workspace state.
   *
   * @param store - Renderer-local owner of committed records and concrete glyph layer state.
   * @param glyphInfo - Optional complete glyph metadata supplied by hosts that need fallback naming.
   * @param editCoordinator - Optional sync lane used by authored layer edits to submit
   * committed changes to the utility workspace.
   */
  constructor({ store, glyphInfo, editCoordinator, reader }: FontOptions) {
    this.#store = store;
    this.#glyphInfo = glyphInfo ?? null;
    this.#reader = reader ?? null;
    this.#editCoordinator = editCoordinator ?? null;

    const fontCell = store.fontCell;

    this.#loadedCell = computed(() => fontCell.value !== null);

    this.#metricsCell = computed(() => fontCell.value?.metrics ?? DEFAULT_FONT_METRICS);
    this.#metricDefinitionsCell = computed(() => fontCell.value?.metricDefinitions ?? []);

    this.#sourceMetricsInterpolationCell = computed(() => {
      const font = fontCell.value;
      return SourceMetricsInterpolation.from(
        font?.sourceMetricsInterpolation ?? null,
        font?.metricDefinitions ?? [],
        font?.metrics ?? DEFAULT_FONT_METRICS,
      );
    });

    this.#kerningCell = store.kerning.cell;

    this.#metadataCell = computed(() => fontCell.value?.metadata ?? {});
    this.#sourcesCell = computed(() => fontCell.value?.sources ?? []);
    this.#axesCell = computed(() => fontCell.value?.axes ?? []);
    this.#axisMappingsCell = computed(() => fontCell.value?.axisMappings ?? []);
    this.#axisMappingBasesCell = computed(() => fontCell.value?.axisMappingBases ?? []);
    this.#designspace = new Designspace({
      axesCell: this.#axesCell,
      mappingBasesCell: this.#axisMappingBasesCell,
      sourcesCell: this.#sourcesCell,
    });
    this.#defaultSourceMetricsCell = computed(() => {
      const designspace = this.#designspace;
      track(this.#metricsCell);
      track(this.#metricDefinitionsCell);

      const source =
        designspace.sourceAt(designspace.defaultLocation()) ?? designspace.sources[0] ?? null;
      return this.#metricsForSource(source);
    });
    this.#namedInstancesCell = computed(() => fontCell.value?.namedInstances ?? []);
    this.#languageIdsCell = computed(() => fontCell.value?.languageIds ?? null);
    this.#directoryCell = computed(
      () => new GlyphDirectory(this.#store.recordIndexCell.value, this.#glyphInfo),
    );
    this.#unicodesCell = computed(() => [...this.#directoryCell.value.unicodes]);
    this.#glyphEntriesCell = computed(() => this.#directoryCell.value.entries);
    this.#glyphRecordsCell = computed(() => this.#directoryCell.value.records);
    this.#glyphsEffect = effect(
      () => {
        track(this.#directoryCell);
        track(this.#sourcesCell);
        this.#updateGlyphsFromStore();
      },
      { name: "font.glyphs" },
    );
  }

  /** @knipclassignore */
  get loaded(): boolean {
    return this.#loadedCell.peek();
  }

  get defaultXAdvance(): number {
    return this.#metricsCell.peek().unitsPerEm / 2;
  }

  /** @knipclassignore */
  get metrics(): FontMetrics {
    return this.#metricsCell.peek();
  }

  /** Standard and technical metrics resolved for the default authored source. */
  get defaultSourceMetrics(): SourceMetrics {
    return this.#defaultSourceMetricsCell.peek();
  }

  /** @knipclassignore */
  get unicodes(): readonly Unicode[] {
    return this.#directoryCell.peek().unicodes;
  }

  /** Reactive loaded state for React hooks and effects. */
  get loadedCell(): Signal<boolean> {
    return this.#loadedCell;
  }

  /** Reactive committed font metrics. */
  get metricsCell(): Signal<FontMetrics> {
    return this.#metricsCell;
  }

  /** Reactive standard and technical metrics for the default authored source. */
  get defaultSourceMetricsCell(): Signal<SourceMetrics> {
    return this.#defaultSourceMetricsCell;
  }

  /** Reactive font-owned identities for authored metric rows. */
  get metricDefinitionsCell(): Signal<MetricDefinition[]> {
    return this.#metricDefinitionsCell;
  }

  /** Reactive decoder for the Rust-built source-metric interpolation model. */
  get sourceMetricsInterpolationCell(): Signal<SourceMetricsInterpolation | null> {
    return this.#sourceMetricsInterpolationCell;
  }

  /** Reactive kerning groups and per-source pair values. */
  get kerningCell(): Signal<Kerning> {
    return this.#kerningCell;
  }

  /** Reactive committed authored font metadata. */
  get metadataCell(): Signal<FontMetadata> {
    return this.#metadataCell;
  }

  /** Reactive committed Unicode assignments. */
  get unicodesCell(): Signal<Unicode[]> {
    return this.#unicodesCell;
  }

  /** Axes, mappings, and sources, with location operations over them. */
  get designspace(): Designspace {
    return this.#designspace;
  }

  /** Reactive committed variation axes for sidebar controls. */
  get axesCell(): Signal<Axis[]> {
    return this.#axesCell;
  }

  /** Reactive font-owned independent and cross-axis mappings. */
  get axisMappingsCell(): Signal<AxisMapping[]> {
    return this.#axisMappingsCell;
  }

  /** Reactive authored product presets in external axis coordinates. */
  get namedInstancesCell(): Signal<NamedInstance[]> {
    return this.#namedInstancesCell;
  }

  /**
   * Reactive tracked Hyperglot language ids (for example `eng-latin`) in authored order.
   *
   * @remarks
   * `null` means the font stores no tracked-language list, so callers apply
   * their own default. An array, including an empty one, is the authored list.
   * Updates after load, committed edits, undo, and redo.
   */
  get languageIdsCell(): Signal<readonly string[] | null> {
    return this.#languageIdsCell;
  }

  /** Reactive committed variation sources for sidebar controls. */
  get sourcesCell(): Signal<Source[]> {
    return this.#sourcesCell;
  }

  /** Reactive source-neutral glyph directory entries for UI lists and grids. */
  get glyphEntriesCell(): Signal<readonly GlyphEntry[]> {
    return this.#glyphEntriesCell;
  }

  /** Reactive committed authored glyph records. */
  get glyphRecordsCell(): Signal<readonly GlyphRecord[]> {
    return this.#glyphRecordsCell;
  }

  /** Increments after every committed native change; track it to follow committed outlines. */
  get committedRevisionCell(): Signal<number> {
    return this.#store.committedRevisionCell;
  }

  /** Glyph roots whose resident atlas entries no longer match the committed font. */
  get invalidGlyphsCell(): Signal<GlyphInvalidation> {
    return this.#store.invalidGlyphsCell;
  }

  /** Returns the layer owning a point id, or null when unknown. */
  layerIdForPoint(pointId: PointId): LayerId | null {
    return this.#store.layerIdForPoint(pointId);
  }

  /** Returns the glyph that owns a layer, or null when unknown. The glyph need not be loaded. */
  glyphIdForLayer(layerId: LayerId): GlyphId | null {
    return this.#store.glyphIdForLayer(layerId);
  }

  /** Returns the contour owning a point id, or null when unknown. */
  contourIdForPoint(pointId: PointId): ContourId | null {
    return this.#store.contourIdForPoint(pointId);
  }

  /** Returns the layer owning an anchor id, or null when unknown. */
  layerIdForAnchor(anchorId: AnchorId): LayerId | null {
    return this.#store.layerIdForAnchor(anchorId);
  }

  /** Returns the layer owning a contour id, or null when unknown. */
  layerIdForContour(contourId: ContourId): LayerId | null {
    return this.#store.layerIdForContour(contourId);
  }

  /** Returns the layer owning a segment id, or null when unknown. */
  layerIdForSegment(segmentId: SegmentId): LayerId | null {
    return this.#store.layerIdForSegment(segmentId);
  }

  /** Returns the contour owning a segment id, or null when unknown. */
  contourIdForSegment(segmentId: SegmentId): ContourId | null {
    return this.#store.contourIdForSegment(segmentId);
  }

  /** Returns the point ids that define a segment, or null when unknown. */
  pointIdsForSegment(segmentId: SegmentId): readonly PointId[] | null {
    return this.#store.pointIdsForSegment(segmentId);
  }

  /** @knipclassignore */
  get metadata(): FontMetadata {
    return this.#metadataCell.peek();
  }

  /**
   * Replaces authored font metadata as one persisted, undoable edit.
   *
   * @param metadata - Complete replacement snapshot; omitted optional fields are cleared.
   * @throws {Error} when the workspace rejects or cannot persist the replacement.
   */
  async updateMetadata(metadata: FontMetadata): Promise<void> {
    await this.editCoordinator.apply(
      [
        {
          kind: "updateFontMetadata",
          updateFontMetadata: { metadata },
        },
      ],
      "Update Font Metadata",
    );
  }

  /**
   * Returns committed glyph records from the current font snapshot.
   *
   * @returns A read-only record list rebuilt after load, create, rename, or reset.
   */
  glyphEntries(): readonly GlyphEntry[] {
    return this.#directoryCell.peek().entries;
  }

  glyphRecords(): readonly GlyphRecord[] {
    return this.#directoryCell.peek().records;
  }

  /**
   * Reads accepted authored layers without loading glyphs into the editor.
   *
   * @remarks
   * Workspace reads follow pending writes; gesture previews are not included.
   * Components are not resolved, so a layer whose component reference is
   * broken stays readable. Nothing is published to the store.
   *
   * @param layerIds - Layer identities in the order results should follow.
   * @returns One snapshot per requested layer.
   * @throws {Error} when workspace authorship is unavailable or a layer identity is unknown.
   */
  async readLayers(layerIds: readonly LayerId[]): Promise<readonly GlyphLayerSnapshot[]> {
    if (!this.#editCoordinator) throw new Error("Authored layers are unavailable in this font");

    return this.#editCoordinator.readLayers(layerIds);
  }

  /** The layer `glyphId` authors in `sourceId`, or `null` when it has none. */
  layerIdFor(glyphId: GlyphId, sourceId: SourceId): LayerId | null {
    return this.#store.layerIdForGlyphSource(glyphId, sourceId);
  }

  /**
   * Reads accepted authored layers together with their composited geometry.
   *
   * @remarks
   * Each root keeps its exact authored geometry; components resolve at that
   * layer's source and cyclic branches are skipped. Both halves come from
   * one workspace read behind pending writes, never from gesture previews or
   * published render models.
   *
   * @param layerIds - Layer identities in the order results should follow.
   * @returns One authored snapshot and resolved geometry per requested layer.
   * @throws {Error} when workspace authorship is unavailable, a layer identity is unknown, or a component cannot resolve.
   */
  async resolveLayers(layerIds: readonly LayerId[]): Promise<readonly LayerRead[]> {
    if (!this.#editCoordinator) throw new Error("Authored layers are unavailable in this font");

    return this.#editCoordinator.resolveLayers(layerIds);
  }

  /**
   * Resolves the preferred glyph name for a Unicode scalar.
   *
   * @remarks
   * Existing font mappings win. Missing codepoints fall back to bundled glyph
   * metadata and finally to a deterministic fallback name.
   *
   * @param unicode - Unicode scalar value to resolve.
   * @returns A production glyph name suitable for opening or creating a glyph.
   */
  nameForUnicode(unicode: Unicode): GlyphName {
    return this.#directoryCell.peek().nameForUnicode(unicode);
  }

  /**
   * Reports whether the current font has a committed glyph with this id.
   *
   * @param glyphId - Stable glyph identity to test against committed font records.
   * @returns `true` only for glyphs present in the loaded font.
   * @knipclassignore
   */
  hasGlyph(glyphId: GlyphId): boolean {
    return this.#directoryCell.peek().hasGlyph(glyphId);
  }

  /**
   * Returns the committed glyph record for a name.
   *
   * @param name - Glyph name to look up in the font directory.
   * @returns The committed record, or `null` when the font does not contain the glyph.
   * @knipclassignore
   */
  entryForName(name: GlyphName): GlyphEntry | null {
    return this.#directoryCell.peek().entryForName(name);
  }

  recordForName(name: GlyphName): GlyphRecord | null {
    return this.#directoryCell.peek().recordForName(name);
  }

  /**
   * Returns the committed Unicode assignments for a glyph name.
   *
   * @param name - Glyph name to look up in the font directory.
   * @returns A read-only assignment list; empty when the glyph is missing or unencoded.
   * @knipclassignore
   */
  unicodesForName(name: GlyphName): readonly Unicode[] {
    return this.#directoryCell.peek().unicodesForName(name);
  }

  /**
   * Returns the first committed Unicode assignment for a glyph name.
   *
   * @param name - Glyph name to look up in the font directory.
   * @returns The primary codepoint, or `null` when the glyph is missing or unencoded.
   * @knipclassignore
   */
  primaryUnicodeForName(name: GlyphName): Unicode | null {
    return this.#directoryCell.peek().primaryUnicodeForName(name);
  }

  /**
   * Returns committed component bases used by a glyph.
   *
   * @param name - Glyph name whose component references should be inspected.
   * @returns Base glyph names from the committed record; empty when absent.
   */
  componentBaseNamesForName(name: GlyphName): readonly GlyphName[] {
    return this.#directoryCell.peek().componentBaseNamesForName(name);
  }

  /**
   * Returns committed glyphs that reference a base glyph as a component.
   *
   * @param name - Base glyph name to reverse-resolve.
   * @returns Sorted dependent glyph names; empty when no committed glyph references it.
   */
  dependentNamesForName(name: GlyphName): readonly GlyphName[] {
    return this.#directoryCell.peek().dependentNamesForName(name);
  }

  /**
   * Resolve a glyph name to an editor handle, even when the glyph is not yet
   * committed in the font.
   *
   * @remarks
   * Name-first flows such as New Glyph need a stable handle before layer data
   * exists. Existing font records provide their committed Unicode assignment;
   * otherwise the glyph database is used as a best-effort Unicode hint.
   *
   * @param name - Production glyph name to open, create, or query.
   * @returns A glyph identity handle. The handle may refer to a glyph that is not in the font yet.
   */
  glyphHandleForName(name: GlyphName): GlyphHandle {
    return this.#directoryCell.peek().glyphHandleForName(name);
  }

  /**
   * Updates an existing glyph's name and Unicode assignment.
   *
   * @throws {Error} always — glyph mutations return with workspace change sets.
   */
  updateGlyphIdentity(glyphId: GlyphId, newName: GlyphName, newUnicodes: Unicode[]): void {
    this.editCoordinator.push({
      kind: "updateGlyph",
      updateGlyph: { glyphId, newName, newUnicodes },
    });
  }

  /**
   * Creates a glyph and its default authored layer.
   *
   * @remarks
   * The durable commit happens asynchronously; the committed glyph and sparse
   * layer membership fold into the font's directory when the workspace echo
   * lands. The layer is authored at the font's default source, and its initial
   * advance comes from the workspace layer-creation policy.
   *
   * @param name - Preferred glyph name. Existing names are auto-incremented
   *   (`base`, `base.1`, …); Unicode assignment is inferred from the
   *   resolved name.
   * @returns The created glyph record with its optimistic default layer.
   */
  createGlyph(name: GlyphName): GlyphRecord {
    const finalName = this.nextAvailableGlyphName(name);
    const handle = this.glyphHandleForName(finalName);
    return this.#createGlyphRecord(finalName, handle.unicode === undefined ? [] : [handle.unicode]);
  }

  /**
   * Creates a glyph encoded at one Unicode scalar, with its default authored layer.
   *
   * @remarks
   * The name comes from bundled glyph metadata, falling back to `uniXXXX` /
   * `uXXXXX`, and is auto-incremented if taken. Unlike {@link createGlyph}, the
   * Unicode value is assigned explicitly, so fallback names stay encoded.
   *
   * @param unicode - Scalar value the new glyph encodes.
   * @returns The created glyph record with its optimistic default layer.
   */
  createGlyphForUnicode(unicode: Unicode): GlyphRecord {
    return this.#createGlyphRecord(this.nextAvailableGlyphName(this.nameForUnicode(unicode)), [
      unicode,
    ]);
  }

  #createGlyphRecord(finalName: GlyphName, unicodes: Unicode[]): GlyphRecord {
    const glyphId = mintGlyphId();
    const layerId = mintLayerId();
    const sourceId = this.defaultSource.id;

    this.editCoordinator.push({
      kind: "createGlyph",
      createGlyph: { glyphId, name: finalName, unicodes },
    });
    this.editCoordinator.push({
      kind: "createGlyphLayer",
      createGlyphLayer: { layerId, glyphId, sourceId },
    });

    return {
      id: glyphId,
      name: finalName,
      unicodes,
      componentBaseGlyphIds: [],
      layers: [{ id: layerId, sourceId }],
    };
  }

  /**
   * Creates an empty authored glyph layer for an existing glyph/source pair.
   *
   * @remarks
   * The layer id is caller-minted and becomes the stable edit identity for
   * subsequent geometry intents. The workspace initializes default metrics;
   * this method does not clone, seed, or copy geometry from another layer.
   *
   * @param glyphId - Committed glyph identity that will own the new layer.
   * @param sourceId - Committed source where the layer is authored.
   * @returns The minted layer id submitted to the workspace.
   */
  createGlyphLayer(glyphId: GlyphId, sourceId: SourceId): LayerId {
    const layerId = mintLayerId();
    this.editCoordinator.push({
      kind: "createGlyphLayer",
      createGlyphLayer: { layerId, glyphId, sourceId },
    });
    return layerId;
  }

  /**
   * Clones an authored glyph layer into another glyph/source pair.
   *
   * @remarks
   * The native intent copies the source layer's editable shape and assigns
   * fresh internal IDs for the cloned contours, points, anchors, components,
   * and guidelines. The clone is one workspace operation and one undo step.
   *
   * @param glyphId - Glyph that will own the new layer.
   * @param sourceId - Source where the new layer is authored.
   * @param fromLayerId - Existing layer whose shape seeds the new layer.
   * @returns The minted layer id submitted to the workspace.
   */
  cloneGlyphLayer(glyphId: GlyphId, sourceId: SourceId, fromLayerId: LayerId): LayerId {
    const layerId = mintLayerId();
    this.editCoordinator.push({
      kind: "cloneGlyphLayer",
      cloneGlyphLayer: { layerId, glyphId, sourceId, fromLayerId },
    });
    return layerId;
  }

  /**
   * Creates an authored layer from resolved geometry at a design-space location.
   *
   * @remarks
   * The existing layer supplies compatible structure and non-varying authored
   * data. Rust assigns fresh internal identities and applies the resolved
   * advance, coordinates, and component transforms as one workspace intent.
   *
   * @param glyphId - Glyph that will own the sparse authored layer.
   * @param sourceId - Source where the layer becomes editable.
   * @param fromLayerId - Compatible authored layer whose structure is retained.
   * @param values - Resolved numeric geometry values to materialize.
   * @returns The minted layer id submitted to the workspace.
   */
  materializeGlyphLayer(
    glyphId: GlyphId,
    sourceId: SourceId,
    fromLayerId: LayerId,
    values: Float64Array,
  ): LayerId {
    if (!this.#glyph(glyphId)) {
      throw new Error(`glyph ${glyphId} must be acquired before materializing a layer`);
    }

    const layerId = mintLayerId();
    this.editCoordinator.push({
      kind: "materializeGlyphLayer",
      materializeGlyphLayer: {
        layerId,
        glyphId,
        sourceId,
        fromLayerId,
        values,
      },
    });
    return layerId;
  }

  /**
   * Finds the next unused glyph name for an auto-incrementing base name.
   *
   * @param name - Preferred base name. Blank input falls back to `newGlyph`.
   * @returns The base name when unused, otherwise `base.1`, `base.2`, and so on.
   */
  nextAvailableGlyphName(name: GlyphName): GlyphName {
    const baseName = (name.trim() || "newGlyph") as GlyphName;
    if (!this.recordForName(baseName)) return baseName;

    for (let index = 1; ; index += 1) {
      const candidate = `${baseName}.${index}` as GlyphName;
      if (!this.recordForName(candidate)) return candidate;
    }
  }

  /**
   * Return the preferred glyph handle for a Unicode codepoint.
   *
   * The returned handle can name a glyph that does not exist in the font yet.
   * Name lookup first uses the loaded font records, then the glyph database,
   * then a deterministic fallback name for unknown codepoints.
   *
   * @example
   * ```ts
   * const handle = font.glyphHandleForUnicode(0x41)
   * // `handle` is suitable for resolving or creating glyph-layer data.
   * ```
   *
   * @returns A glyph identity for the codepoint. This does not load or create glyph geometry.
   */
  glyphHandleForUnicode(unicode: Unicode): GlyphHandle {
    const name = this.nameForUnicode(unicode);
    return { name, unicode };
  }

  /**
   * Returns canonical identity and metadata for a committed glyph.
   *
   * @param glyphId - Stable glyph identity to inspect.
   * @returns The committed glyph record, or `null` when the font does not contain the glyph.
   */
  entryForId(glyphId: GlyphId): GlyphEntry | null {
    return this.#directoryCell.peek().entryForId(glyphId);
  }

  recordForId(glyphId: GlyphId): GlyphRecord | null {
    return this.#directoryCell.peek().recordForId(glyphId);
  }

  /**
   * Returns the local glyph model for a stable glyph id.
   *
   * @param glyphId - document glyph identity to resolve.
   * @returns The id-keyed glyph model, or `null` when the glyph is not in the current font.
   */
  #glyph(glyphId: GlyphId): Glyph | null {
    return this.#store.glyphForId(glyphId);
  }

  #assembleGlyph(glyphId: GlyphId): Glyph | null {
    const entry = this.#directoryCell.peek().entryForId(glyphId);
    if (!entry) return null;

    const record = this.#directoryCell.peek().recordForId(glyphId);
    const layers = record ? this.#buildGlyphLayers(record) : [];
    if (!layers) return null;

    return new Glyph({
      entry,
      layers,
      componentGlyphs: new Map(),
      designspace: this.#designspace,
      projectionCell: this.#store.projectionCell(entry.id),
      defaultSourceId: this.defaultSource.id,
    });
  }

  #buildGlyphLayers(record: GlyphRecord): GlyphLayer[] | null {
    const glyph = this.#store.glyphForId(record.id);
    const layers: GlyphLayer[] = [];

    for (const layerRecord of record.layers) {
      const source = this.source(layerRecord.sourceId);
      const stateCell = this.#store.layerStateCell(layerRecord.id);
      track(stateCell);
      const state = stateCell.peek();
      if (!source || !state) return null;

      const existingLayer = glyph?.layerForId(layerRecord.id);
      if (existingLayer && existingLayer.geometryCell === state.geometryCell) {
        existingLayer.replaceSource(source);
        layers.push(existingLayer);
        continue;
      }

      layers.push(new GlyphLayer(source, this.#editCoordinator, state));
    }

    return layers;
  }

  /**
   * Collects the loaded glyphs a glyph's components reference, transitively.
   *
   * @returns The resident component glyphs, plus the referenced glyphs that
   * are not loaded yet; their own dependencies are found once they load.
   */
  #componentGlyphsFor(glyphId: GlyphId, glyphs?: ReadonlyMap<GlyphId, Glyph>): ComponentGlyphs {
    const componentGlyphs = new Map<GlyphId, Glyph>();
    const missingGlyphIds: GlyphId[] = [];
    const directory = this.#directoryCell.peek();
    const record = directory.recordForId(glyphId);
    const pendingGlyphIds = [
      ...(record?.componentBaseGlyphIds ??
        this.#store.projection(glyphId)?.componentGlyphIds ??
        []),
    ];
    const seenGlyphIds = new Set<GlyphId>([glyphId]);

    while (pendingGlyphIds.length > 0) {
      const componentGlyphId = pendingGlyphIds.shift()!;
      if (seenGlyphIds.has(componentGlyphId)) continue;

      seenGlyphIds.add(componentGlyphId);
      const componentGlyph =
        glyphs?.get(componentGlyphId) ?? this.#store.glyphForId(componentGlyphId);
      if (!componentGlyph) {
        missingGlyphIds.push(componentGlyphId);
        continue;
      }

      componentGlyphs.set(componentGlyphId, componentGlyph);
      const componentRecord = directory.recordForId(componentGlyphId);
      pendingGlyphIds.push(
        ...(componentRecord?.componentBaseGlyphIds ??
          this.#store.projection(componentGlyphId)?.componentGlyphIds ??
          []),
      );
    }

    return { glyphs: componentGlyphs, missingGlyphIds };
  }

  async #readGlyphsIntoStore(glyphIds: readonly GlyphId[]): Promise<void> {
    const uniqueIds = uniqueInOrder(glyphIds).filter((glyphId) =>
      Boolean(this.#store.entryForId(glyphId)),
    );

    const seen = await this.#readGlyphSnapshots(
      uniqueIds.filter((glyphId) => !this.#store.glyphForId(glyphId)),
    );
    const glyphs = new Map<GlyphId, Glyph>();

    for (const glyphId of seen) {
      if (this.#store.glyphForId(glyphId)) continue;

      const glyph = this.#assembleGlyph(glyphId);
      if (!glyph) {
        throw new Error(`current-font glyph ${glyphId} could not be read`);
      }
      glyphs.set(glyphId, glyph);
    }

    for (const glyph of glyphs.values()) {
      const componentGlyphs = this.#componentGlyphsFor(glyph.id, glyphs);
      if (componentGlyphs.missingGlyphIds.length > 0) {
        throw new Error(`component glyphs for ${glyph.id} could not be read`);
      }
      glyph.replaceComponentGlyphs(componentGlyphs.glyphs);
    }

    this.#store.setGlyphs([...glyphs.values()]);
    this.#updateGlyphsFromStore();
  }

  #updateGlyphsFromStore(): void {
    const missingGlyphIds = new Set<GlyphId>();

    const directory = this.#directoryCell.peek();

    batch(() => {
      for (const glyph of this.#store.loadedGlyphs()) {
        const entry = directory.entryForId(glyph.id);
        if (!entry) continue;

        const record = directory.recordForId(entry.id);
        const layers = record ? this.#buildGlyphLayers(record) : [];
        const componentGlyphs = this.#componentGlyphsFor(entry.id);
        for (const glyphId of componentGlyphs.missingGlyphIds) missingGlyphIds.add(glyphId);
        if (!layers || componentGlyphs.missingGlyphIds.length > 0) continue;

        glyph.replaceEntry(entry);
        glyph.replaceLayers(layers);
        glyph.replaceComponentGlyphs(componentGlyphs.glyphs);
      }
    });

    if (missingGlyphIds.size > 0) void this.#loadComponentGlyphs([...missingGlyphIds]);
  }

  /**
   * Loads glyphs newly referenced as components by resident glyphs.
   *
   * @remarks
   * A component can reference a glyph that was never opened, for example one
   * added from the component picker. Loading it stores the glyph and re-runs
   * {@link Font.#updateGlyphsFromStore}, which then resolves the component outline.
   * Runs from the directory effect, so failures are logged rather than thrown.
   */
  async #loadComponentGlyphs(glyphIds: readonly GlyphId[]): Promise<void> {
    try {
      await this.#glyphRequests(glyphIds);
    } catch (error) {
      console.error("failed to load component glyphs", error);
    }
  }

  /**
   * Reads one current-font glyph and returns its live model.
   *
   * @param glyphId - Current-font glyph identity whose model should be available.
   * @returns The glyph model for `glyphId`.
   * @throws {Error} when `glyphId` is not a current-font glyph or cannot be read.
   */
  async loadGlyph(glyphId: GlyphId): Promise<Glyph> {
    const glyphs = await this.loadGlyphs([glyphId]);

    const first = glyphs[0];
    if (!first) throw new Error(`current-font glyph ${glyphId} could not be read`);

    return first;
  }

  /**
   * Reads current-font glyphs and returns their live models in request order.
   *
   * @remarks
   * Component bases discovered while reading the requested glyphs are read too,
   * but the returned list contains only the glyph IDs requested by the caller.
   *
   * @param glyphIds - Current-font glyph identities whose models should be available.
   * @returns Glyph models aligned with `glyphIds`, including duplicate requests.
   * @throws {Error} when any requested glyph ID is not in the current font or cannot be read.
   */
  async loadGlyphs(glyphIds: readonly GlyphId[]): Promise<readonly Glyph[]> {
    for (const glyphId of glyphIds) {
      if (!this.#store.entryForId(glyphId)) {
        throw new Error(`glyph ${glyphId} is not in the current font`);
      }
    }

    await this.#glyphRequests(glyphIds.filter((id) => !this.#store.glyphForId(id)));

    return glyphIds.map((glyphId) => {
      const glyph = this.#store.glyphForId(glyphId);
      if (!glyph) throw new Error(`current-font glyph ${glyphId} could not be read`);

      return glyph;
    });
  }

  /**
   * Derives Rust-owned entity mappings between two authored layers.
   *
   * Incomplete results contain structural diagnostics but no partial entity
   * mappings. The layers must belong to the same glyph.
   */
  matchLayers(referenceLayerId: LayerId, targetLayerId: LayerId): Promise<LayerMatch> {
    return this.editCoordinator.matchLayers(referenceLayerId, targetLayerId);
  }

  /**
   * Resolves drawable previews (svg path + advance) at one design location.
   *
   * @remarks
   * Previews are printed by the bridge at `location` and carry no editable
   * structure — the payload stays orders of magnitude lighter than a glyph
   * load. Use {@link loadGlyphs} when a live model is needed. Missing or
   * shapeless glyphs are omitted from the result.
   *
   * @param glyphIds - Current-font glyph identities to preview.
   * @param location - Internal design location to resolve shapes at.
   * @returns One preview per resolvable glyph.
   */
  async glyphPreviews(
    glyphIds: readonly GlyphId[],
    location: DesignAxisLocation,
  ): Promise<readonly GlyphPreview[]> {
    if (this.#editCoordinator) {
      return this.#editCoordinator.readGlyphPreviews(
        glyphIds,
        locationFromDesignAxisLocation(location),
      );
    }

    return this.#reader?.glyphPreviews(glyphIds, location) ?? [];
  }

  async #readGlyphSnapshots(glyphIds: readonly GlyphId[]): Promise<readonly GlyphId[]> {
    const queue = uniqueInOrder(glyphIds);
    if (queue.length === 0) return [];

    if (this.#reader) {
      const snapshots = await this.#reader.read(queue);
      const byGlyphId = new Map(snapshots.map((snapshot) => [snapshot.glyphId, snapshot]));
      for (const glyphId of queue) {
        if (!byGlyphId.get(glyphId)?.projection) {
          throw new Error(`source did not return glyph projection ${glyphId}`);
        }
      }
      for (const snapshot of snapshots) {
        if (!this.#store.entryForId(snapshot.glyphId) || !snapshot.projection) {
          throw new Error(`source returned invalid glyph projection ${snapshot.glyphId}`);
        }
      }

      // Validate the entire closure before one batched publication. Failed reads
      // publish nothing and remain retryable.
      this.#store.applyGlyphSnapshots(snapshots);
      return snapshots.map((snapshot) => snapshot.glyphId);
    }

    const seen = new Set<GlyphId>(queue);
    if (!this.#editCoordinator) return [...seen];

    // No settled() here: readGlyphSnapshots already orders reads behind
    // pending writes via the coordinator queue, and draining the queue first
    // would stall every read behind all other in-flight reads.
    while (queue.length > 0) {
      const batchGlyphIds = queue.splice(0);
      await this.#readAndApplyGlyphRequests(batchGlyphIds.map((glyphId) => ({ glyphId })));

      // load the component glyphs and skip ones we've seen
      for (const glyphId of batchGlyphIds) {
        for (const componentGlyphId of this.#store.componentBaseGlyphIdsInLayerState(glyphId)) {
          if (seen.has(componentGlyphId)) continue;
          seen.add(componentGlyphId);
          if (!this.#store.glyphForId(componentGlyphId)) queue.push(componentGlyphId);
        }
      }
    }

    return [...seen];
  }

  async #readAndApplyGlyphRequests(requests: readonly GlyphSnapshotRequest[]): Promise<void> {
    if (!this.#editCoordinator) return;

    const snapshots = await this.#editCoordinator.readGlyphSnapshots(requests);
    this.#store.applyGlyphSnapshots(snapshots);
  }

  /**
   * Returns the store-owned state for an authored layer.
   *
   * @param layerId - stable authored layer identity to resolve.
   * @returns The layer state, or `null` when it is not available in the current font model.
   */
  layerState(layerId: LayerId): GlyphLayerState | null {
    return this.#store.layerState(layerId);
  }

  /**
   * Return the source used for default editing/rendering context.
   *
   * Variable fonts prefer the source at the default axis location. Static or
   * fresh fonts fall back to the first source provided by the bridge.
   *
   * @returns The default source.
   * @throws When no source exists. A loaded font must always have at least one source.
   */
  get defaultSource(): Source {
    const source = this.sourceAt(this.defaultLocation()) ?? this.sources[0];
    if (!source) {
      throw new Error("Loaded font has no default source");
    }
    return source;
  }

  /**
   * Find a source by id.
   *
   * @returns The exact source, or `null` when the id is not part of this font.
   */
  source(sourceId: SourceId): Source | null {
    return this.#peekDesignspace((designspace) => designspace.source(sourceId));
  }

  /**
   * Resolves the external user-control location representing an authored source.
   *
   * @remarks
   * Rust-compiled independent mappings are inverted exactly. Sources with
   * unreachable internal coordinates retain the externally controlled portion
   * of their design location so source selection always has stable slider values.
   *
   * @param sourceId - Existing source whose location should appear in axis controls.
   * @returns A fresh external location, or `null` when the source does not exist.
   */
  externalLocationForSource(sourceId: SourceId): ExternalAxisLocation | null {
    const source = this.source(sourceId);
    if (!source) return null;

    return this.#peekDesignspace((designspace) =>
      designspace.toExternal(designAxisLocationFromLocation(source.location)),
    );
  }

  /**
   * Find the source whose designspace location matches an external location after mapping.
   *
   * Use this when exact source identity matters, for example before editing a
   * specific source. Use {@link sourceAtOrDefault} when UI code can fall back to
   * the font's default source.
   *
   * @returns The exact matching source, or `null` when the location is interpolated.
   */
  sourceAt(location: ExternalAxisLocation): Source | null {
    return this.#peekDesignspace((designspace) => designspace.sourceAt(location));
  }

  /**
   * Returns a reactive exact source for an external location cell.
   *
   * @param location - Cell containing the external location to map and match exactly.
   * @returns A cell whose value is the exact source, or `null` when interpolated.
   */
  sourceAtCell(location: Signal<ExternalAxisLocation>): ComputedSignal<Source | null> {
    return computed(() => this.#designspace.sourceAt(location.value), {
      name: "font.sourceAt",
    });
  }

  /**
   * Find an exact source for a location, or fall back to the default source.
   *
   * This is useful for UI bootstrapping where a fresh/static font should still
   * resolve to its default authoring source even when the current location does
   * not exactly identify one.
   *
   * @returns The matching source or the font's default source.
   */
  sourceAtOrDefault(location: ExternalAxisLocation): Source {
    return this.sourceAt(location) ?? this.defaultSource;
  }

  nearestSource(location: ExternalAxisLocation): Source | null {
    return this.#peekDesignspace((designspace) => designspace.nearestSource(location));
  }

  /** @knipclassignore — used by VariationPanel component */
  isVariable(): boolean {
    return this.getAxes().length > 0;
  }

  /**
   * Returns the renderer queue for committed edits awaiting utility echoes.
   *
   * @remarks
   * Save and dirty semantics live in the utility workspace; this queue only
   * tracks renderer-submitted edits and serializes reads behind them.
   *
   * @throws {Error} when constructed without a workspace-backed edit lane.
   */
  get editCoordinator(): WorkspaceEditCoordinator {
    if (!this.#editCoordinator) {
      throw new Error("editing is not wired to the workspace yet");
    }

    return this.#editCoordinator;
  }

  /**
   * Creates a global font source without creating glyph layers.
   *
   * @remarks
   * Glyph layers at this source are materialized separately by editor
   * workflows, usually when a glyph is first edited or selected at the source.
   *
   * @param name - Display name for the source.
   * @param location - External user-space location for the source.
   * @returns The minted source id submitted to the workspace.
   */
  createSource(name: string, externalLocation: ExternalAxisLocation): SourceId {
    const sourceId = mintSourceId();
    const metrics = this.metricsAtLocation(externalLocation);
    const designLocation = locationFromDesignAxisLocation(
      this.#peekDesignspace((designspace) => designspace.toDesign(externalLocation)),
    );
    this.editCoordinator.push({
      kind: "createSource",
      createSource: { sourceId, name, location: designLocation },
    });
    if (metrics.metricValues.length === this.#metricDefinitionsCell.peek().length) {
      this.editCoordinator.push({
        kind: "updateSource",
        updateSource: {
          sourceId,
          name,
          location: designLocation,
          metricValues: [...metrics.metricValues],
          italicAngle: metrics.italicAngle,
          lineGap: metrics.lineGap,
          underlinePosition: metrics.underlinePosition,
          underlineThickness: metrics.underlineThickness,
        },
      });
    }

    return sourceId;
  }

  /**
   * Queues replacement of the tracked language list on the workspace edit lane.
   *
   * @remarks
   * {@link languageIdsCell} changes only after the workspace echo is folded.
   * Rust drops blank ids and keeps the first occurrence of duplicates. Call
   * inside an edit-coordinator transaction to control the undo step label.
   *
   * @param languageIds - Hyperglot language ids in display order; an empty
   * list is stored as an explicit empty list.
   */
  setLanguageIds(languageIds: readonly string[]): void {
    this.editCoordinator.push({
      kind: "setLanguages",
      setLanguages: { languageIds: [...languageIds] },
    });
  }

  /**
   * Creates one variation axis with renderer-minted stable identity.
   *
   * @param axis - Complete axis definition apart from the id assigned here.
   * @returns The id submitted to the workspace.
   */
  createAxis(axis: AxisDefinition): AxisId {
    const axisId = mintAxisId();
    this.editCoordinator.push({
      kind: "createAxis",
      createAxis: { axis: { id: axisId, ...axis } },
    });

    return axisId;
  }

  /**
   * Replaces an existing axis definition as one persisted, undoable edit.
   *
   * @param axis - Complete replacement axis returned from the current font model.
   * @throws {Error} when the definition is invalid or cannot be persisted.
   */
  async updateAxis(axis: Axis): Promise<void> {
    await this.editCoordinator.apply(
      [
        {
          kind: "updateAxis",
          updateAxis: { axis },
        },
      ],
      "Update Axis",
    );
  }

  /**
   * Replaces the font-owned mapping collection as one undoable edit.
   *
   * @param mappings - Complete ordered mapping collection; Rust validates all axis references.
   * @throws {Error} when the collection is invalid or cannot be persisted.
   */
  async setAxisMappings(mappings: readonly AxisMapping[]): Promise<void> {
    await this.editCoordinator.apply(
      [
        {
          kind: "setAxisMappings",
          setAxisMappings: { mappings: [...mappings] },
        },
      ],
      "Update Axis Mappings",
    );
  }

  /** Replaces the font-owned metric row definitions as one undoable edit. */
  async setMetricDefinitions(definitions: readonly MetricDefinition[]): Promise<void> {
    await this.editCoordinator.apply(
      [
        {
          kind: "setMetricDefinitions",
          setMetricDefinitions: { definitions: [...definitions] },
        },
      ],
      "Update Metric Definitions",
    );
  }

  /** Replaces one source's name, location, and complete metric values. */
  async updateSource(source: Source): Promise<void> {
    await this.editCoordinator.apply(
      [
        {
          kind: "updateSource",
          updateSource: {
            sourceId: source.id,
            name: source.name,
            location: source.location,
            metricValues: source.metricValues,
            italicAngle: source.italicAngle,
            lineGap: source.lineGap,
            underlinePosition: source.underlinePosition,
            underlineThickness: source.underlineThickness,
          },
        },
      ],
      "Update Source",
    );
  }

  /**
   * Creates an explicit named product preset at a complete external location.
   *
   * @remarks
   * Named instances do not own glyph geometry. Their locations continue to
   * express author intent when axis mappings change; compiler-facing locations
   * are derived only during export.
   *
   * @param instance - Authored name, optional PostScript name, and complete external location.
   * @returns The stable instance id submitted to the workspace.
   */
  createNamedInstance(instance: NamedInstanceDefinition): NamedInstanceId {
    const instanceId = mintNamedInstanceId();
    this.editCoordinator.push({
      kind: "createNamedInstance",
      createNamedInstance: { instance: { id: instanceId, ...instance } },
    });

    return instanceId;
  }

  /**
   * Replaces an authored product preset and resolves after the workspace accepts it.
   *
   * @param instance - complete replacement retaining the preset's stable identity.
   * @throws {Error} when the replacement violates instance or axis constraints, or persistence fails.
   */
  async updateNamedInstance(instance: NamedInstance): Promise<void> {
    await this.editCoordinator.apply(
      [
        {
          kind: "updateNamedInstance",
          updateNamedInstance: { instance },
        },
      ],
      "Update Instance",
    );
  }

  /** Removes an authored product preset without touching sources or glyph geometry. */
  deleteNamedInstance(instanceId: NamedInstanceId): void {
    this.editCoordinator.push({
      kind: "deleteNamedInstance",
      deleteNamedInstance: { instanceId },
    });
  }

  /** @knipclassignore — used by VariationPanel component */
  deleteAxis(axisId: AxisId): void {
    this.editCoordinator.push({
      kind: "deleteAxis",
      deleteAxis: { axisId },
    });
  }

  deleteSource(sourceId: SourceId): void {
    this.editCoordinator.push({
      kind: "deleteSource",
      deleteSource: { sourceId },
    });
  }

  /** @knipclassignore — used by VariationPanel component */
  getAxes(): Axis[] {
    return this.#axesCell.peek();
  }

  /** Returns the current font-owned mapping collection. */
  getAxisMappings(): AxisMapping[] {
    return this.#axisMappingsCell.peek();
  }

  /** Returns the Rust-compiled mapping bases for external-to-design evaluation. */
  getAxisMappingBases(): AxisMappingBasis[] {
    return this.#axisMappingBasesCell.peek();
  }

  /** Returns font-owned identities and semantics for authored metric rows. */
  get metricDefinitions(): MetricDefinition[] {
    return this.#metricDefinitionsCell.peek();
  }

  /** Returns the current explicit named product presets. */
  get namedInstances(): NamedInstance[] {
    return this.#namedInstancesCell.peek();
  }

  /**
   * Evaluates independent mappings followed by cross-axis mappings in Rust.
   *
   * @param location - External location keyed by stable axis id; omitted axes use defaults.
   * @returns The mapped location after pending workspace edits have settled.
   */
  mapLocation(location: Location): Promise<Location> {
    return this.editCoordinator.mapLocation(location);
  }

  /** @knipclassignore — used by VariationPanel component */
  get sources(): Source[] {
    return this.#sourcesCell.peek();
  }

  /** Resolves standard and technical metrics for one authored source. */
  metricsForSource(sourceId: SourceId): SourceMetrics {
    const source = this.source(sourceId);
    if (!source) throw new Error(`Unknown source: ${sourceId}`);

    return this.#metricsForSource(source);
  }

  /**
   * Resolves source-owned metrics at a design-space location.
   *
   * @remarks
   * Exact source locations return their authored values. Intermediate
   * locations evaluate the Rust-built variation model used by the glyph
   * interpolation path. Sparse optional technical fields remain undefined
   * between sources; the model includes them only when every master authors a
   * value.
   *
   * @param location - External location displayed by editor controls.
   * @returns Resolved standard and technical metrics in font units.
   */
  metricsAtLocation(location: ExternalAxisLocation): SourceMetrics {
    const { designLocation, exactSource, axes } = this.#peekDesignspace((designspace) => {
      const designLocation = designspace.toDesign(location);
      return {
        designLocation,
        exactSource: designspace.sourceAtDesign(designLocation),
        axes: designspace.axes,
      };
    });
    if (exactSource) return this.#metricsForSource(exactSource);

    return (
      this.#sourceMetricsInterpolationCell.peek()?.resolve(designLocation, axes) ??
      this.defaultSourceMetrics
    );
  }

  /**
   * Resolves the kerning between `first` followed by `second`.
   *
   * @remarks
   * A variable font blends the sources kerning is authored at, evaluated at
   * the active source's location when one is being edited and at `location`
   * otherwise, so every location shows what the compiled font kerns there.
   * A source without pairs of its own, such as a sparse intermediate master,
   * therefore shows the blended value. A static font reads the active or
   * default source.
   *
   * @param location - External location displayed by editor controls.
   * @param sourceId - Source being edited, which takes precedence over `location`.
   * @returns Font units added after `first`'s advance; zero when no pair applies.
   */
  kerningBetween(
    first: GlyphId,
    second: GlyphId,
    location: ExternalAxisLocation,
    sourceId: SourceId | null,
  ): number {
    const kerning = this.#kerningCell.peek();
    // An authoring source reads its own values, including ones not echoed yet,
    // whose source the Rust-built basis may not cover until the echo arrives.
    if (sourceId && kerning.authors(sourceId)) {
      return kerning.valueAtSource(sourceId, first, second);
    }
    const { designLocation, staticSourceId, axes } = this.#peekDesignspace((designspace) => {
      const source = sourceId ? designspace.source(sourceId) : null;
      const staticSource = source ?? designspace.sourceAt(designspace.defaultLocation());
      return {
        designLocation: source
          ? designAxisLocationFromLocation(source.location)
          : designspace.toDesign(location),
        staticSourceId: staticSource?.id ?? null,
        axes: designspace.axes,
      };
    });

    const interpolated = kerning.valueAtLocation(designLocation, axes, first, second);
    if (interpolated !== null) return interpolated;
    return staticSourceId ? kerning.valueAtSource(staticSourceId, first, second) : 0;
  }

  /**
   * Opens a kerning edit: previews show at once, and committing submits one
   * undoable change whose values stay visible until the workspace confirms them.
   *
   * @throws {Error} When another kerning edit is open, or editing is not wired.
   */
  beginKerningEdit(): KerningEdit {
    return new KerningEdit(this.#store.kerning, this.editCoordinator);
  }

  /**
   * Sets or removes kerning values as one undo step, shown at once.
   *
   * @param edits - Values to set at sources; an absent `amount` removes the pair there.
   * @param label - Undo label.
   */
  setKerningValues(edits: readonly KerningValueEdit[], label: string): void {
    const edit = this.beginKerningEdit();
    edit.preview(edits);
    edit.commit(label);
  }

  #metricsForSource(source: Source | null): SourceMetrics {
    const unitsPerEm = this.#metricsCell.peek().unitsPerEm;
    const definitions = this.#metricDefinitionsCell.peek();
    const position = (kind: MetricKind): number | undefined => {
      const definition = definitions.find((candidate) => candidate.kind === kind);
      if (!definition) return undefined;

      return source?.metricValues.find((value) => value.metricId === definition.id)?.position;
    };
    const unloaded = source === null;

    return {
      unitsPerEm,
      metricValues: source?.metricValues ?? [],
      ascender: position("ascender") ?? unitsPerEm * 0.8,
      descender: position("descender") ?? unitsPerEm * -0.2,
      baseline: position("baseline") ?? 0,
      capHeight: position("capHeight") ?? (unloaded ? unitsPerEm * 0.7 : undefined),
      xHeight: position("xHeight") ?? (unloaded ? unitsPerEm * 0.5 : undefined),
      lineGap: source?.lineGap,
      italicAngle: source?.italicAngle,
      underlinePosition: source?.underlinePosition,
      underlineThickness: source?.underlineThickness,
    };
  }

  dispose(): void {
    this.#glyphsEffect.dispose();
  }

  defaultLocation(): ExternalAxisLocation {
    return this.#peekDesignspace((designspace) => designspace.defaultLocation());
  }

  /**
   * Reads the designspace without subscribing the current reactive reader.
   *
   * @remarks
   * These Font lookups have always read with `peek()`, and reactive callers
   * depend on that: the catalog's metrics read `metricsForSource(activeSourceId)`
   * and would throw on a just-deleted source if a source-list change re-ran
   * them before the editor moves off it. Readers that must follow the
   * designspace use `designspace` (or `sourceAtCell`) directly.
   */
  #peekDesignspace<T>(read: (designspace: Designspace) => T): T {
    return untracked(() => read(this.#designspace));
  }
}
