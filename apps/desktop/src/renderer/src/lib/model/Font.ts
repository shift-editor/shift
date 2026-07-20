import type {
  FontMetrics,
  MetricDefinition,
  MetricKind,
  FontMetadata,
  Axis,
  AxisDefinition,
  AxisMapping,
  Source,
  GlyphId,
  GlyphProjection,
  GlyphRecord,
  GlyphLayerShape,
  GlyphLayerRecord,
  GlyphName,
  SourceId,
  Unicode,
  AxisId,
  AnchorId,
  ContourId,
  LayerId,
  Location,
  PointId,
  GlyphStructure,
  NamedInstance,
  NamedInstanceDefinition,
  NamedInstanceId,
  InterpolationBasis,
  SourceMetrics,
} from "@shift/types";
import {
  mintAxisId,
  mintGlyphId,
  mintLayerId,
  mintNamedInstanceId,
  mintSourceId,
} from "@shift/types";
import type { SegmentId } from "@shift/glyph-state";
import { computed, signal, track, type Signal } from "@/lib/signals/signal";
import type { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";
import type { WorkspaceGlyphSnapshotRequest } from "@shared/workspace/protocol";
import { Glyph, GlyphGeometry, GlyphView, type GlyphLayer } from "./Glyph";
import type { FontStore } from "./FontStore";
import type { GlyphLayerState } from "./GlyphLayerState";
import type { GlyphHandle } from "@shift/bridge";
import { SourceMetricsInterpolation } from "./SourceMetricsInterpolation";
import {
  axisLocationDistanceSquared,
  axisLocationFromLocation,
  axisLocationsEqual,
  defaultAxisLocation,
  emptyAxisLocation,
} from "@/lib/variation/location";
import type { AxisLocation } from "@/types/variation";
import { defaultResources, GlyphInfo } from "@shift/glyph-info";
import { uniqueInOrder } from "@/lib/utils/utils";
import { fallbackGlyphNameForUnicode } from "../utils/unicode";
import {
  interpolateSourceValues,
  interpolationWeights,
} from "@/lib/interpolation/InterpolationBasis";

export interface GlyphGeometrySelection {
  readonly points?: Iterable<PointId>;
  readonly anchors?: Iterable<AnchorId>;
  readonly contours?: Iterable<ContourId>;
  readonly segments?: Iterable<SegmentId>;
}

interface LayerDirectoryEntry {
  readonly glyphId: GlyphId;
  readonly layer: GlyphLayerRecord;
}

const EMPTY_GLYPH_STRUCTURE: GlyphStructure = {
  contours: [],
  anchors: [],
  components: [],
};

/**
 * Immutable lookup index for committed glyph records.
 *
 * @remarks
 * `GlyphDirectory` is rebuilt whenever the bridge glyph list changes. It keeps
 * source-of-truth font records separate from fallback glyph database knowledge:
 * methods named `record*`, `has*`, and dependency lookups only describe glyphs
 * committed in the font, while handle/name resolution methods may fall back to
 * bundled glyph metadata so UI flows can address glyphs before they are created.
 */
// One shared database for every directory rebuild: constructing GlyphInfo
// indexes the full glyph dataset (~60k search docs) and must not run per
// workspace snapshot.
let glyphDatabase: GlyphInfo | null = null;

function getGlyphDatabase(): GlyphInfo {
  glyphDatabase ??= new GlyphInfo(defaultResources);
  return glyphDatabase;
}

class GlyphDirectory {
  #glyphDatabase = getGlyphDatabase();

  readonly records: readonly GlyphRecord[];
  readonly unicodes: readonly Unicode[];

  readonly recordsByName: ReadonlyMap<GlyphName, GlyphRecord> = new Map();
  readonly recordsById: ReadonlyMap<GlyphId, GlyphRecord> = new Map();
  readonly nameById: ReadonlyMap<GlyphId, GlyphName> = new Map();
  readonly nameByUnicode: ReadonlyMap<Unicode, GlyphName> = new Map();
  readonly layerById: ReadonlyMap<LayerId, LayerDirectoryEntry> = new Map();
  readonly layerByGlyphAndSource: ReadonlyMap<string, GlyphLayerRecord> = new Map();
  readonly componentBasesById: ReadonlyMap<GlyphId, readonly GlyphId[]> = new Map();
  readonly dependentsById: ReadonlyMap<GlyphId, ReadonlySet<GlyphId>> = new Map();

  private constructor(records: readonly GlyphRecord[]) {
    const recordsByName = new Map<GlyphName, GlyphRecord>();
    const recordsById = new Map<GlyphId, GlyphRecord>();
    const nameById = new Map<GlyphId, GlyphName>();
    const nameByUnicode = new Map<Unicode, GlyphName>();
    const layerById = new Map<LayerId, LayerDirectoryEntry>();
    const layerByGlyphAndSource = new Map<string, GlyphLayerRecord>();
    const componentBasesById = new Map<GlyphId, readonly GlyphId[]>();
    const dependentsById = new Map<GlyphId, Set<GlyphId>>();

    for (const record of records) {
      recordsByName.set(record.name, record);
      recordsById.set(record.id, record);
      nameById.set(record.id, record.name);

      for (const layer of record.layers) {
        layerById.set(layer.id, { glyphId: record.id, layer });
        layerByGlyphAndSource.set(glyphLayerKey(record.id, layer.sourceId), layer);
      }

      for (const unicode of record.unicodes) {
        if (!nameByUnicode.has(unicode)) {
          nameByUnicode.set(unicode, record.name);
        }
      }
      componentBasesById.set(record.id, record.componentBaseGlyphIds);
      for (const baseId of record.componentBaseGlyphIds) {
        let dependents = dependentsById.get(baseId);
        if (!dependents) {
          dependents = new Set<GlyphId>();
          dependentsById.set(baseId, dependents);
        }
        dependents.add(record.id);
      }
    }

    this.records = [...records];
    this.unicodes = [...nameByUnicode.keys()].sort((a, b) => a - b);
    this.recordsByName = recordsByName;
    this.recordsById = recordsById;
    this.nameById = nameById;
    this.nameByUnicode = nameByUnicode;
    this.layerById = layerById;
    this.layerByGlyphAndSource = layerByGlyphAndSource;
    this.componentBasesById = componentBasesById;
    this.dependentsById = dependentsById;
  }

  /**
   * Builds a directory snapshot from bridge glyph records.
   *
   * @param records - Committed glyph records from the current font snapshot.
   * @returns A new immutable lookup index; later record changes are not observed.
   */
  static fromRecords(records: readonly GlyphRecord[]): GlyphDirectory {
    return new GlyphDirectory(records);
  }

  /**
   * Resolves the preferred glyph name for a Unicode scalar.
   *
   * @remarks
   * Existing font mappings win. Missing codepoints fall back to bundled glyph
   * metadata and finally to a deterministic `uniXXXX`-style name.
   *
   * @param unicode - Unicode scalar value to resolve.
   * @returns A production glyph name suitable for opening or creating a glyph.
   */
  nameForUnicode(unicode: Unicode): GlyphName {
    const nameFromFont = this.nameByUnicode.get(unicode);
    if (nameFromFont) return nameFromFont;

    const nameFromDatabase = this.#glyphDatabase.getGlyphName(unicode);
    if (nameFromDatabase) return nameFromDatabase;

    const fallbackName = fallbackGlyphNameForUnicode(unicode);
    return fallbackName as GlyphName;
  }

  /**
   * Reports whether the current font has a committed glyph with this id.
   *
   * @param glyphId - Stable glyph identity to test against committed font records.
   * @returns `true` only for glyphs present in the loaded font.
   * @knipclassignore
   */
  hasGlyph(glyphId: GlyphId): boolean {
    return this.recordsById.has(glyphId);
  }

  /**
   * Returns the committed glyph record for a name.
   *
   * @param name - Glyph name to look up in the font directory.
   * @returns The committed record, or `null` when the font does not contain the glyph.
   * @knipclassignore
   */
  recordForName(name: GlyphName): GlyphRecord | null {
    return this.recordsByName.get(name) ?? null;
  }

  /** Returns the committed glyph record for a stable glyph id. */
  recordForId(glyphId: GlyphId): GlyphRecord | null {
    return this.recordsById.get(glyphId) ?? null;
  }

  /** Returns the sparse authored layer for a glyph/source pair. */
  layerForGlyphAtSource(glyphId: GlyphId, sourceId: SourceId): GlyphLayerRecord | null {
    return this.layerByGlyphAndSource.get(glyphLayerKey(glyphId, sourceId)) ?? null;
  }

  /** Returns the sparse authored layer and owning glyph for a layer id. */
  layerForId(layerId: LayerId): LayerDirectoryEntry | null {
    return this.layerById.get(layerId) ?? null;
  }

  /** Returns the sparse authored layer for a glyph name and source. */
  layerForGlyphNameAtSource(name: GlyphName, sourceId: SourceId): GlyphLayerRecord | null {
    const record = this.recordForName(name);
    if (!record) return null;
    return this.layerForGlyphAtSource(record.id, sourceId);
  }

  /**
   * Returns the committed Unicode assignments for a glyph name.
   *
   * @param name - Glyph name to look up in the font directory.
   * @returns A read-only assignment list; empty when the glyph is missing or unencoded.
   * @knipclassignore
   */
  unicodesForName(name: GlyphName): readonly Unicode[] {
    return this.recordsByName.get(name)?.unicodes ?? [];
  }

  /**
   * Returns the first committed Unicode assignment for a glyph name.
   *
   * @param name - Glyph name to look up in the font directory.
   * @returns The primary codepoint, or `null` when the glyph is missing or unencoded.
   * @knipclassignore
   */
  primaryUnicodeForName(name: GlyphName): Unicode | null {
    return this.unicodesForName(name)[0] ?? null;
  }

  /**
   * Returns committed component bases used by a glyph.
   *
   * @param name - Glyph name whose component references should be inspected.
   * @returns Base glyph names from the committed record; empty when absent.
   */
  componentBaseNamesForName(name: GlyphName): readonly GlyphName[] {
    const record = this.recordForName(name);
    if (!record) return [];
    return (this.componentBasesById.get(record.id) ?? [])
      .map((glyphId) => this.nameById.get(glyphId))
      .filter((baseName): baseName is GlyphName => baseName !== undefined);
  }

  /**
   * Returns committed glyphs that reference a base glyph as a component.
   *
   * @param name - Base glyph name to reverse-resolve.
   * @returns Sorted dependent glyph names; empty when no committed glyph references it.
   */
  dependentNamesForName(name: GlyphName): readonly GlyphName[] {
    const record = this.recordForName(name);
    if (!record) return [];
    return [...(this.dependentsById.get(record.id) ?? [])]
      .map((glyphId) => this.nameById.get(glyphId))
      .filter((dependentName): dependentName is GlyphName => dependentName !== undefined)
      .sort();
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
    const record = this.recordForName(name);
    const unicode = record
      ? this.primaryUnicodeForName(name)
      : (this.#glyphDatabase.getGlyphByName(name)?.codepoint ?? null);
    return unicode === null ? { name } : { name, unicode };
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
 */
export class Font {
  readonly #loadedCell: Signal<boolean>;
  readonly #metricsCell: Signal<FontMetrics>;
  readonly #metricDefinitionsCell: Signal<MetricDefinition[]>;
  readonly #sourceMetricsInterpolationCell: Signal<SourceMetricsInterpolation | null>;
  readonly #defaultSourceMetricsCell: Signal<SourceMetrics>;
  readonly #metadataCell: Signal<FontMetadata>;
  readonly #sourcesCell: Signal<Source[]>;
  readonly #axesCell: Signal<Axis[]>;
  readonly #axisMappingsCell: Signal<AxisMapping[]>;
  readonly #namedInstancesCell: Signal<NamedInstance[]>;
  readonly #unicodesCell: Signal<Unicode[]>;
  readonly #glyphRecordsCell: Signal<readonly GlyphRecord[]>;

  readonly #directoryCell: Signal<GlyphDirectory>;
  readonly #store: FontStore;
  readonly #editCoordinator: WorkspaceEditCoordinator | null;
  readonly #pendingProjectionIds = new Set<GlyphId>();
  readonly #readingProjectionIds = new Set<GlyphId>();
  #projectionRead: Promise<void> | null = null;
  readonly #basisWeightCells = new WeakMap<
    InterpolationBasis,
    WeakMap<Signal<AxisLocation>, Signal<Float64Array>>
  >();
  /**
   * Builds a font model over renderer-local workspace state.
   *
   * @param store - Renderer-local owner of committed records and concrete glyph layer state.
   * @param editCoordinator - Optional sync lane used by authored layer edits to submit
   * committed changes to the utility workspace.
   */
  constructor(store: FontStore, editCoordinator?: WorkspaceEditCoordinator) {
    this.#store = store;
    this.#editCoordinator = editCoordinator ?? null;
    const workspaceCell = store.workspaceCell;
    this.#loadedCell = computed(() => workspaceCell.value !== null);
    this.#metricsCell = computed(() => workspaceCell.value?.metrics ?? DEFAULT_FONT_METRICS);
    this.#metricDefinitionsCell = computed(() => workspaceCell.value?.metricDefinitions ?? []);
    this.#sourceMetricsInterpolationCell = computed(() => {
      const workspace = workspaceCell.value;
      return SourceMetricsInterpolation.from(
        workspace?.sourceMetricsInterpolation ?? null,
        workspace?.metricDefinitions ?? [],
        workspace?.metrics ?? DEFAULT_FONT_METRICS,
      );
    });
    this.#metadataCell = computed(() => workspaceCell.value?.metadata ?? {});
    this.#sourcesCell = computed(() => workspaceCell.value?.sources ?? []);
    this.#axesCell = computed(() => workspaceCell.value?.axes ?? []);
    this.#defaultSourceMetricsCell = computed(() => {
      const sources = this.#sourcesCell.value;
      const axes = this.#axesCell.value;
      track(this.#metricsCell);
      track(this.#metricDefinitionsCell);
      const source =
        sourceAtLocation(sources, axes, defaultAxisLocation(axes)) ?? sources[0] ?? null;
      return this.#metricsForSource(source);
    });
    this.#axisMappingsCell = computed(() => workspaceCell.value?.axisMappings ?? []);
    this.#namedInstancesCell = computed(() => workspaceCell.value?.namedInstances ?? []);
    this.#directoryCell = computed(() =>
      GlyphDirectory.fromRecords(workspaceCell.value?.glyphs ?? []),
    );
    this.#unicodesCell = computed(() => [...this.#directoryCell.value.unicodes]);
    this.#glyphRecordsCell = computed(() => this.#directoryCell.value.records);
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

  /** Reactive committed authored font metadata. */
  get metadataCell(): Signal<FontMetadata> {
    return this.#metadataCell;
  }

  /** Reactive committed Unicode assignments. */
  get unicodesCell(): Signal<Unicode[]> {
    return this.#unicodesCell;
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

  /** Reactive committed variation sources for sidebar controls. */
  get sourcesCell(): Signal<Source[]> {
    return this.#sourcesCell;
  }

  /** Reactive committed glyph directory records for UI lists and grids. */
  get glyphRecordsCell(): Signal<readonly GlyphRecord[]> {
    return this.#glyphRecordsCell;
  }

  /** Returns the layer owning a point id, or null when unknown. */
  layerIdForPoint(pointId: PointId): LayerId | null {
    return this.#store.layerIdForPoint(pointId);
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

  /**
   * Resolves geometry ids to the single authored layer that owns all of them.
   *
   * @remarks
   * This is the edit-scoping primitive for identity-only selections: continuous
   * edits such as dragging or copying must target exactly one authored layer.
   * Ownership comes from current concrete layer state, so ids that are unknown
   * to the font model resolve to `null`.
   *
   * @param ids - Geometry ids to resolve. Empty input resolves to `null`.
   * @returns The sole owning authored layer, or `null` when any id is unknown
   * or the ids span multiple layers.
   */
  layerForGeometry(ids: GlyphGeometrySelection): GlyphLayer | null {
    let owner: LayerId | null = null;

    const fold = (layerId: LayerId | null): boolean => {
      if (!layerId || (owner !== null && owner !== layerId)) return false;
      owner = layerId;
      return true;
    };

    for (const pointId of ids.points ?? []) {
      if (!fold(this.layerIdForPoint(pointId))) return null;
    }
    for (const anchorId of ids.anchors ?? []) {
      if (!fold(this.layerIdForAnchor(anchorId))) return null;
    }
    for (const contourId of ids.contours ?? []) {
      if (!fold(this.layerIdForContour(contourId))) return null;
    }
    for (const segmentId of ids.segments ?? []) {
      if (!fold(this.layerIdForSegment(segmentId))) return null;
    }

    return owner === null ? null : this.layerById(owner);
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
  glyphRecords(): readonly GlyphRecord[] {
    return this.#directoryCell.peek().records;
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
    const unicodes = handle.unicode === undefined ? [] : [handle.unicode];
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
   * @param location - Internal design-space location to materialize.
   * @returns The minted layer id submitted to the workspace.
   */
  materializeGlyphLayer(
    glyphId: GlyphId,
    sourceId: SourceId,
    fromLayerId: LayerId,
    location: AxisLocation,
  ): LayerId {
    const layerId = mintLayerId();
    const geometry = this.#glyphGeometry(glyphId, location, axisLocationSignal(location));
    this.editCoordinator.push({
      kind: "materializeGlyphLayer",
      materializeGlyphLayer: {
        layerId,
        glyphId,
        sourceId,
        fromLayerId,
        values: geometry.values,
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
  glyph(glyphId: GlyphId): GlyphRecord | null {
    return this.#directoryCell.peek().recordForId(glyphId);
  }

  /**
   * Returns a reactive glyph identity record for a glyph id cell.
   *
   * @param glyphId - Cell containing the glyph to resolve, or `null` when no glyph is selected.
   * @returns A cell whose value is the committed glyph record, or `null` when unavailable.
   */
  glyphCell(glyphId: Signal<GlyphId | null>): Signal<GlyphRecord | null> {
    return computed(
      () => {
        const id = glyphId.value;
        if (!id) return null;

        return this.#directoryCell.value.recordForId(id);
      },
      { name: "font.glyph" },
    );
  }

  /**
   * Returns the authored mutable layer for an exact glyph/source pair.
   *
   * @param glyphId - Stable glyph identity to resolve.
   * @param sourceId - Authored source identity to resolve.
   * @returns The authored layer, or `null` when the glyph/source pair is unavailable.
   */
  layer(glyphId: GlyphId, sourceId: SourceId): GlyphLayer | null {
    return this.#glyphLayer(glyphId, sourceId);
  }

  /**
   * Returns the authored mutable layer for a stable layer id.
   *
   * @param layerId - Stable authored layer identity from selection or font records.
   * @returns The authored layer, or `null` when the layer is unavailable in the current font.
   */
  layerById(layerId: LayerId): GlyphLayer | null {
    const entry = this.#directoryCell.peek().layerForId(layerId);
    if (!entry) return null;

    return this.#glyphLayer(entry.glyphId, entry.layer.sourceId);
  }

  /**
   * Returns a reactive authored layer for glyph and source id cells.
   *
   * @param glyphId - Cell containing the glyph to resolve, or `null` when no glyph is selected.
   * @param sourceId - Cell containing the exact source to resolve, or `null` when interpolated.
   * @returns A cell whose value is the authored layer, or `null` when unavailable.
   */
  layerCell(
    glyphId: Signal<GlyphId | null>,
    sourceId: Signal<SourceId | null>,
  ): Signal<GlyphLayer | null> {
    return computed(
      () => {
        track(this.#directoryCell);
        track(this.#sourcesCell);

        const id = glyphId.value;
        const source = sourceId.value;
        if (!id || !source) return null;

        return this.layer(id, source);
      },
      { name: "font.layer" },
    );
  }

  /**
   * Returns the resolved read/render/hit-test view for a glyph at a design location.
   *
   * @param glyphId - Stable glyph identity to resolve.
   * @param location - Reactive designspace location for the view.
   * @returns The resolved view, or `null` when its local backing is unavailable.
   */
  glyphView(glyphId: GlyphId, location: AxisLocation | Signal<AxisLocation>): GlyphView | null {
    if (!this.#store.recordForId(glyphId)) return null;
    if (!this.#glyph(glyphId) && !this.#store.projection(glyphId)) return null;

    const locationSignal = axisLocationSignal(location);
    return this.#store.glyphView(glyphId, locationSignal, () =>
      this.#createGlyphView(glyphId, locationSignal),
    );
  }

  /**
   * Returns a reactive glyph view for a glyph id cell and design location cell.
   *
   * @param glyphId - Cell containing the glyph to resolve, or `null` when no glyph is selected.
   * @param location - Cell containing the designspace location to render and hit-test.
   * @returns A cell whose value is the resolved glyph view, or `null` when unavailable.
   */
  glyphViewCell(
    glyphId: Signal<GlyphId | null>,
    location: Signal<AxisLocation>,
  ): Signal<GlyphView | null> {
    return computed(
      () => {
        track(this.#directoryCell);
        track(this.#axesCell);
        track(this.#sourcesCell);

        const id = glyphId.value;
        if (!id) return null;

        track(this.#store.projectionCell(id));
        return this.glyphView(id, location);
      },
      { name: "font.glyphView" },
    );
  }

  /**
   * Returns reactive glyph views aligned with a stable list of glyph identities.
   *
   * @remarks
   * The returned cell observes projection arrival, authored layer arrival, and
   * font topology changes. Each non-null view follows `location` directly, so
   * changing the location does not recreate the view or retain location-keyed
   * geometry snapshots.
   *
   * This method is synchronous. Call {@link requestGlyphViews} at an async UI
   * boundary when lightweight backing has not been requested yet.
   *
   * @param glyphIds - Glyph identities whose views should be returned in order.
   * @param location - Shared reactive designspace location for the views.
   * @returns A cell aligned with `glyphIds`; unavailable backing produces `null`.
   */
  glyphViewsCell(
    glyphIds: readonly GlyphId[],
    location: Signal<AxisLocation>,
  ): Signal<readonly (GlyphView | null)[]> {
    return computed(
      () => {
        track(this.#directoryCell);
        track(this.#axesCell);
        track(this.#sourcesCell);

        return glyphIds.map((glyphId) => {
          track(this.#store.projectionCell(glyphId));
          return this.glyphView(glyphId, location);
        });
      },
      { name: "font.glyphViews" },
    );
  }

  /**
   * Returns the authored layer that exactly matches a designspace location.
   *
   * @param glyphId - Stable glyph identity to resolve.
   * @param location - Current designspace location.
   * @returns The editable layer at the exact source location, or `null` for interpolated views.
   */
  editableLayerAt(glyphId: GlyphId, location: AxisLocation): GlyphLayer | null {
    const source = this.sourceAt(location);
    if (!source) return null;

    return this.layer(glyphId, source.id);
  }

  /**
   * Returns the local glyph model for a stable glyph id.
   *
   * @param glyphId - document glyph identity to resolve.
   * @returns The id-keyed glyph model, or `null` when the glyph is not in the current font.
   */
  #glyph(glyphId: GlyphId): Glyph | null {
    if (!this.loaded) return null;

    const directory = this.#directoryCell.peek();
    const record = directory.recordForId(glyphId);
    if (!record) return null;

    return this.#store.glyph(glyphId, () => {
      const source = this.defaultSource;
      const layer = directory.layerForGlyphAtSource(glyphId, source.id);
      if (!layer) return null;

      const stateCell = this.#store.layerStateCell(layer.id);
      track(stateCell);
      const state = stateCell.peek();
      if (!state) return null;

      return new Glyph(this, glyphId, directory.glyphHandleForName(record.name), source, state);
    });
  }

  /**
   * Returns local authored layer data for an exact glyph/source pair.
   *
   * @param glyphId - document glyph identity to resolve.
   * @param sourceId - exact source whose authored layer should be loaded.
   * @returns the id-keyed glyph layer model, or null when record or geometry is unavailable.
   */
  #glyphLayer(glyphId: GlyphId, sourceId: SourceId): GlyphLayer | null {
    const source = this.source(sourceId);
    if (!source) return null;

    const layer = this.#directoryCell.peek().layerForGlyphAtSource(glyphId, source.id);
    if (!layer) return null;

    return this.#store.glyphLayer(glyphId, source.id, () => {
      const glyph = this.#glyph(glyphId);
      if (!glyph) return null;

      const stateCell = this.#store.layerStateCell(layer.id);
      track(stateCell);
      const state = glyph.isPrimarySource(source) ? undefined : stateCell.peek();
      return glyph.createGlyphLayer(source, state);
    });
  }

  #glyphGeometry(
    glyphId: GlyphId,
    location: AxisLocation,
    locationCell: Signal<AxisLocation>,
  ): GlyphGeometry {
    const exactSource = this.sourceAt(location);
    if (exactSource) {
      const layer = this.layer(glyphId, exactSource.id);
      if (layer) return layer.geometry;
    }

    const projectionCell = this.#store.projectionCell(glyphId);
    track(projectionCell);
    const projection = projectionCell.peek();
    if (projection) {
      return this.#projectedGlyphGeometry(glyphId, projection, locationCell, exactSource);
    }

    return this.#glyph(glyphId)?.primaryGeometryForFont ?? emptyGlyphGeometry();
  }

  #projectedGlyphGeometry(
    glyphId: GlyphId,
    projection: GlyphProjection,
    locationCell: Signal<AxisLocation>,
    exactSource: Source | null,
  ): GlyphGeometry {
    if (exactSource?.id === this.defaultSource.id) {
      return glyphGeometryFromShape(projection.fallback);
    }

    const exactShape = projection.exactSourceShapes.find(
      (sourceShape) => sourceShape.sourceId === exactSource?.id,
    );
    if (exactShape) return glyphGeometryFromShape(exactShape.shape);

    const interpolation = projection.interpolation;
    if (!interpolation) return glyphGeometryFromShape(projection.fallback);

    const weightsCell = this.#weightsForBasis(interpolation.basis, locationCell);
    track(weightsCell);
    const weights = weightsCell.peek();
    const values = interpolateSourceValues(interpolation.basis, weights, (sourceId) => {
      const liveValues = this.#authoredGlyphValues(glyphId, sourceId);
      if (liveValues) return liveValues;

      return interpolation.sources.find((source) => source.sourceId === sourceId)?.values ?? null;
    });
    if (!values) return glyphGeometryFromShape(projection.fallback);

    return new GlyphGeometry(projection.fallback.structure, values);
  }

  #weightsForBasis(
    basis: InterpolationBasis,
    location: Signal<AxisLocation>,
  ): Signal<Float64Array> {
    let byLocation = this.#basisWeightCells.get(basis);
    if (!byLocation) {
      byLocation = new WeakMap();
      this.#basisWeightCells.set(basis, byLocation);
    }

    const existing = byLocation.get(location);
    if (existing) return existing;

    const weights = computed(
      () => interpolationWeights(basis, location.value, this.#axesCell.value),
      { name: "font.interpolationWeights" },
    );
    byLocation.set(location, weights);
    return weights;
  }

  #authoredGlyphValues(glyphId: GlyphId, sourceId: SourceId): Float64Array | null {
    track(this.#directoryCell);
    const layer = this.#directoryCell.peek().layerForGlyphAtSource(glyphId, sourceId);
    if (!layer) return null;

    const stateCell = this.#store.layerStateCell(layer.id);
    track(stateCell);
    const state = stateCell.peek();
    if (!state) return null;

    track(state.structureCell);
    track(state.coordinateBuffersChangedCell);
    return state.state.values;
  }

  #createGlyphView(glyphId: GlyphId, location: Signal<AxisLocation>): GlyphView {
    const layer = computed(
      () => {
        const currentLocation = location.value;
        track(this.#directoryCell);
        track(this.#axesCell);
        track(this.#sourcesCell);

        return this.editableLayerAt(glyphId, currentLocation);
      },
      { name: "font.glyphView.layer" },
    );
    const geometry = computed(
      () => {
        const currentLocation = location.value;
        track(this.#directoryCell);
        track(this.#axesCell);
        track(this.#sourcesCell);

        return this.#glyphGeometry(glyphId, currentLocation, location);
      },
      { name: "font.glyphView.geometry" },
    );

    return new GlyphView(
      glyphId,
      location,
      layer,
      geometry,
      this.#store.projectionCell(glyphId),
      (resolvedLocation) => this.sourceAt(resolvedLocation)?.id ?? null,
      (resolvedGlyphId, resolvedLocation) => {
        track(this.#directoryCell);
        track(this.#axesCell);
        track(this.#sourcesCell);

        return this.editableLayerAt(resolvedGlyphId, resolvedLocation);
      },
      (resolvedGlyphId, resolvedLocation) => {
        track(this.#directoryCell);
        track(this.#axesCell);
        track(this.#sourcesCell);

        return this.#glyphGeometry(resolvedGlyphId, resolvedLocation, location);
      },
    );
  }

  /**
   * Reads one current-font glyph and returns its live model.
   *
   * @param glyphId - Current-font glyph identity whose model should be available.
   * @returns The glyph model for `glyphId`.
   * @throws {Error} when `glyphId` is not a current-font glyph or cannot be read.
   * @see {@link loadGlyphs}
   */
  async loadGlyph(glyphId: GlyphId): Promise<Glyph> {
    const glyph = (await this.loadGlyphs([glyphId]))[0];
    if (!glyph) throw new Error(`current-font glyph ${glyphId} could not be read`);
    return glyph;
  }

  /**
   * Requests missing location-independent backing for renderer glyph views.
   *
   * @remarks
   * Calls are batched and coalesced by glyph identity. The request does not
   * capture a design location; existing views observe projection arrival and
   * continue following their own location signals synchronously.
   *
   * UI code normally reaches this through `useGlyphViews` rather than managing
   * bridge reads directly.
   *
   * @param glyphIds - Root glyph identities whose projections are needed.
   * @internal
   */
  async requestGlyphViews(glyphIds: readonly GlyphId[]): Promise<void> {
    if (!this.#editCoordinator) return;

    for (const glyphId of uniqueInOrder(glyphIds)) {
      if (this.#store.projection(glyphId)) continue;
      if (this.#readingProjectionIds.has(glyphId)) continue;

      this.#pendingProjectionIds.add(glyphId);
    }

    if (!this.#projectionRead && this.#pendingProjectionIds.size > 0) {
      this.#projectionRead = this.#drainProjectionReads();
    }

    await this.#projectionRead;
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
    const uniqueIds = uniqueInOrder(glyphIds);
    for (const glyphId of uniqueIds) {
      if (!this.#store.recordForId(glyphId)) {
        throw new Error(`glyph ${glyphId} is not in the current font`);
      }
    }
    await this.#readGlyphSnapshots(uniqueIds);

    const glyphs = new Map<GlyphId, Glyph>();
    for (const glyphId of uniqueIds) {
      const glyph = this.#glyph(glyphId);
      if (!glyph) {
        throw new Error(`current-font glyph ${glyphId} could not be read`);
      }
      glyphs.set(glyphId, glyph);
    }

    return glyphIds.map((glyphId) => glyphs.get(glyphId)!);
  }

  async #readGlyphSnapshots(glyphIds: readonly GlyphId[]): Promise<void> {
    if (!this.#editCoordinator || glyphIds.length === 0) return;

    await this.#editCoordinator.settled();

    const queue = uniqueInOrder(glyphIds);
    const seen = new Set<GlyphId>(queue);

    while (queue.length > 0) {
      const batchGlyphIds = queue.splice(0);
      await this.#readAndApplyGlyphRequests(batchGlyphIds.map((glyphId) => ({ glyphId })));

      for (const glyphId of batchGlyphIds) {
        for (const baseGlyphId of this.#store.componentBaseGlyphIdsInLayerState(glyphId)) {
          if (seen.has(baseGlyphId)) continue;
          seen.add(baseGlyphId);
          queue.push(baseGlyphId);
        }
      }
    }
  }

  async #readAndApplyGlyphRequests(
    requests: readonly WorkspaceGlyphSnapshotRequest[],
  ): Promise<void> {
    if (!this.#editCoordinator) return;

    this.#store.applyGlyphSnapshots(await this.#editCoordinator.readGlyphSnapshots(requests));
  }

  async #readAndApplyGlyphProjections(glyphIds: readonly GlyphId[]): Promise<void> {
    if (!this.#editCoordinator) return;

    const projections = await this.#editCoordinator.readGlyphProjections(glyphIds);
    this.#store.applyGlyphProjections(projections);
  }

  async #drainProjectionReads(): Promise<void> {
    try {
      while (this.#pendingProjectionIds.size > 0) {
        const glyphIds = [...this.#pendingProjectionIds].filter(
          (glyphId) => !this.#store.projection(glyphId),
        );
        this.#pendingProjectionIds.clear();
        if (glyphIds.length === 0) continue;

        for (const glyphId of glyphIds) this.#readingProjectionIds.add(glyphId);
        try {
          await this.#readAndApplyGlyphProjections(glyphIds);
        } finally {
          for (const glyphId of glyphIds) this.#readingProjectionIds.delete(glyphId);
        }
      }
    } finally {
      this.#projectionRead = null;
    }
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
    const sources = this.sources;

    return sourceById(sources, sourceId);
  }

  /**
   * Find the source whose designspace location exactly matches a location.
   *
   * Use this when exact source identity matters, for example before editing a
   * specific source. Use {@link sourceAtOrDefault} when UI code can fall back to
   * the font's default source.
   *
   * @returns The exact matching source, or `null` when the location is interpolated.
   */
  sourceAt(location: AxisLocation): Source | null {
    return sourceAtLocation(this.sources, this.getAxes(), location);
  }

  /**
   * Returns a reactive exact source for a design location cell.
   *
   * @param location - Cell containing the designspace location to match exactly.
   * @returns A cell whose value is the exact source, or `null` when interpolated.
   */
  sourceAtCell(location: Signal<AxisLocation>): Signal<Source | null> {
    return computed(
      () => sourceAtLocation(this.#sourcesCell.value, this.#axesCell.value, location.value),
      { name: "font.sourceAt" },
    );
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
  sourceAtOrDefault(location: AxisLocation): Source {
    return this.sourceAt(location) ?? this.defaultSource;
  }

  nearestSource(location: AxisLocation): Source | null {
    const axes = this.getAxes();
    let nearest: { source: Source; distance: number } | null = null;

    for (const source of this.sources) {
      const sourceLocation = axisLocationFromLocation(source.location);
      const distance = axisLocationDistanceSquared(sourceLocation, location, axes);

      if (!nearest || distance < nearest.distance) {
        nearest = { source, distance };
      }
    }

    if (!nearest) return null;

    return nearest.source;
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
   * @param location - Design-space location owned by the source.
   * @returns The minted source id submitted to the workspace.
   */
  createSource(name: string, location: Location): SourceId {
    const sourceId = mintSourceId();
    const metrics = this.metricsAtLocation(axisLocationFromLocation(location));
    this.editCoordinator.push({
      kind: "createSource",
      createSource: { sourceId, name, location },
    });
    if (metrics.metricValues.length === this.#metricDefinitionsCell.peek().length) {
      this.editCoordinator.push({
        kind: "updateSource",
        updateSource: {
          sourceId,
          name,
          location,
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
   * @param location - Internal design-space location used by source masters.
   * @returns Resolved standard and technical metrics in font units.
   */
  metricsAtLocation(location: AxisLocation): SourceMetrics {
    const axes = this.#axesCell.peek();
    const exactSource = sourceAtLocation(this.#sourcesCell.peek(), axes, location);
    if (exactSource) return this.#metricsForSource(exactSource);

    return (
      this.#sourceMetricsInterpolationCell.peek()?.resolve(location, axes) ??
      this.defaultSourceMetrics
    );
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

  defaultLocation(): AxisLocation {
    return this.isVariable() ? defaultAxisLocation(this.getAxes()) : emptyAxisLocation();
  }
}

function sourceById(sources: readonly Source[], sourceId: SourceId): Source | null {
  for (const source of sources) {
    if (source.id === sourceId) return source;
  }

  return null;
}

function glyphGeometryFromShape(shape: GlyphLayerShape): GlyphGeometry {
  return new GlyphGeometry(shape.structure, shape.values);
}

function sourceAtLocation(
  sources: readonly Source[],
  axes: readonly Axis[],
  location: AxisLocation,
): Source | null {
  for (const source of sources) {
    const sourceLocation = axisLocationFromLocation(source.location);
    if (axisLocationsEqual(sourceLocation, location, axes)) return source;
  }

  return null;
}

function glyphLayerKey(glyphId: GlyphId, sourceId: SourceId): string {
  return `${glyphId}:${sourceId}`;
}

function axisLocationSignal(location: AxisLocation | Signal<AxisLocation>): Signal<AxisLocation> {
  if (isSignal(location)) return location;

  return signal(location);
}

function emptyGlyphGeometry(): GlyphGeometry {
  return new GlyphGeometry(EMPTY_GLYPH_STRUCTURE, new Float64Array([0]));
}

function isSignal<T>(value: T | Signal<T>): value is Signal<T> {
  return typeof value === "object" && value !== null && "peek" in value && "value" in value;
}
