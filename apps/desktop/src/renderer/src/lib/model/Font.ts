import type {
  FontMetrics,
  FontMetadata,
  Axis,
  Source,
  GlyphId,
  GlyphRecord,
  GlyphLayerRecord,
  GlyphName,
  GlyphVariationData,
  SourceId,
  Unicode,
  AxisId,
  LayerId,
  Location,
  GlyphStructure,
} from "@shift/types";
import { mintAxisId, mintGlyphId, mintLayerId, mintSourceId } from "@shift/types";
import { computed, signal, track, type Signal } from "@/lib/signals/signal";
import type { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";
import type { WorkspaceGlyphSnapshotRequest } from "@shared/workspace/protocol";
import {
  Glyph,
  GlyphGeometry,
  type GlyphInstance,
  type GlyphInstanceInput,
  type GlyphLayer,
} from "./Glyph";
import { GlyphOutline } from "./GlyphOutline";
import type { FontStore, GlyphSnapshotStatus } from "./FontStore";
import type { GlyphLayerState } from "./GlyphLayerState";
import type { GlyphHandle } from "@shift/bridge";
import {
  axisLocationDistanceSquared,
  axisLocationFromLocation,
  axisLocationsEqual,
  defaultAxisLocation,
  emptyAxisLocation,
} from "@/lib/variation/location";
import type { AxisLocation } from "@/types/variation";
import { defaultResources, GlyphInfo } from "@shift/glyph-info";
import { fallbackGlyphNameForUnicode } from "../utils/unicode";
import { interpolate, normalize } from "@/lib/interpolation/interpolate";

export type GlyphLoadOptions = {
  readonly sourceIds?: readonly SourceId[];
};

type SnapshotRequest = {
  glyphId: GlyphId;
  sourceIds: SourceId[];
};

type InFlightKey = string & { readonly __inFlightKey: unique symbol };

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
 * bundled glyph metadata so UI flows can address missing glyphs.
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
  readonly layerByGlyphAndSource: ReadonlyMap<string, GlyphLayerRecord> = new Map();
  readonly componentBasesById: ReadonlyMap<GlyphId, readonly GlyphId[]> = new Map();
  readonly dependentsById: ReadonlyMap<GlyphId, ReadonlySet<GlyphId>> = new Map();

  private constructor(records: readonly GlyphRecord[]) {
    const recordsByName = new Map<GlyphName, GlyphRecord>();
    const recordsById = new Map<GlyphId, GlyphRecord>();
    const nameById = new Map<GlyphId, GlyphName>();
    const nameByUnicode = new Map<Unicode, GlyphName>();
    const layerByGlyphAndSource = new Map<string, GlyphLayerRecord>();
    const componentBasesById = new Map<GlyphId, readonly GlyphId[]>();
    const dependentsById = new Map<GlyphId, Set<GlyphId>>();

    for (const record of records) {
      recordsByName.set(record.name, record);
      recordsById.set(record.id, record);
      nameById.set(record.id, record.name);

      for (const layer of record.layers) {
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
  ascender: 800,
  descender: -200,
  capHeight: 700,
  xHeight: 500,
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
  readonly #metadataCell: Signal<FontMetadata>;
  readonly #sourcesCell: Signal<Source[]>;
  readonly #axesCell: Signal<Axis[]>;
  readonly #unicodesCell: Signal<Unicode[]>;
  readonly #glyphRecordsCell: Signal<readonly GlyphRecord[]>;

  readonly #directoryCell: Signal<GlyphDirectory>;
  readonly #store: FontStore;
  readonly #editCoordinator: WorkspaceEditCoordinator | null;
  readonly #glyphLoadsInFlight = new Map<InFlightKey, Promise<void>>();

  /**
   * Projects the renderer's workspace snapshot into the font domain model.
   *
   * @param store - Renderer-local owner of committed records and loaded glyph snapshots.
   * @param editCoordinator - Optional sync lane used by authored layer projections to submit
   *   committed edits to the utility workspace.
   */
  constructor(store: FontStore, editCoordinator?: WorkspaceEditCoordinator) {
    this.#store = store;
    this.#editCoordinator = editCoordinator ?? null;
    const workspaceCell = store.workspaceCell;
    this.#loadedCell = computed(() => workspaceCell.value !== null);
    this.#metricsCell = computed(() => workspaceCell.value?.metrics ?? DEFAULT_FONT_METRICS);
    this.#metadataCell = computed(() => workspaceCell.value?.metadata ?? {});
    this.#sourcesCell = computed(() => workspaceCell.value?.sources ?? []);
    this.#axesCell = computed(() => workspaceCell.value?.axes ?? []);
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

  /** Reactive committed Unicode assignments. */
  get unicodesCell(): Signal<Unicode[]> {
    return this.#unicodesCell;
  }

  /** Reactive committed variation axes for sidebar controls. */
  get axesCell(): Signal<Axis[]> {
    return this.#axesCell;
  }

  /** Reactive committed variation sources for sidebar controls. */
  get sourcesCell(): Signal<Source[]> {
    return this.#sourcesCell;
  }

  /** Reactive committed glyph directory records for UI lists and grids. */
  get glyphRecordsCell(): Signal<readonly GlyphRecord[]> {
    return this.#glyphRecordsCell;
  }

  /** Reactive glyph snapshot bookkeeping for model consumers that derive local glyph views. */
  get glyphSnapshotStatusCell(): Signal<ReadonlyMap<GlyphId, GlyphSnapshotStatus>> {
    return this.#store.snapshotStatusCell;
  }

  /** @knipclassignore */
  get metadata(): FontMetadata {
    return this.#metadataCell.peek();
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
   * @returns A glyph identity handle. The handle may refer to a missing glyph.
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
   * @returns The loaded authored layer, or `null` when the glyph/source pair is unavailable.
   */
  layer(glyphId: GlyphId, sourceId: SourceId): GlyphLayer | null {
    return this.#glyphLayer(glyphId, sourceId);
  }

  /**
   * Returns a reactive authored layer for glyph and source id cells.
   *
   * @param glyphId - Cell containing the glyph to resolve, or `null` when no glyph is selected.
   * @param sourceId - Cell containing the exact source to resolve, or `null` when interpolated.
   * @returns A cell whose value is the loaded authored layer, or `null` when unavailable.
   */
  layerCell(
    glyphId: Signal<GlyphId | null>,
    sourceId: Signal<SourceId | null>,
  ): Signal<GlyphLayer | null> {
    return computed(
      () => {
        track(this.#directoryCell);
        track(this.#store.snapshotStatusCell);
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
   * Returns the resolved read/render/hit-test instance for a glyph at a design location.
   *
   * @param glyphId - Stable glyph identity to resolve.
   * @param location - Reactive designspace location for the instance.
   * @returns The resolved instance, or `null` when the glyph is not available locally.
   */
  instance(glyphId: GlyphId, location: AxisLocation | Signal<AxisLocation>): GlyphInstance | null {
    const glyph = this.#glyphModel(glyphId);
    if (!glyph) return null;

    const locationSignal = axisLocationSignal(location);
    const existing = glyph.cachedInstanceForFont(locationSignal);
    if (existing) return existing;

    return glyph.createInstanceForFont(this.#glyphInstanceInput(glyph, locationSignal));
  }

  /**
   * Returns a reactive glyph instance for a glyph id cell and design location cell.
   *
   * @param glyphId - Cell containing the glyph to resolve, or `null` when no glyph is selected.
   * @param location - Cell containing the designspace location to render and hit-test.
   * @returns A cell whose value is the resolved glyph instance, or `null` when unavailable.
   */
  instanceCell(
    glyphId: Signal<GlyphId | null>,
    location: Signal<AxisLocation>,
  ): Signal<GlyphInstance | null> {
    return computed(
      () => {
        track(this.#directoryCell);
        track(this.#store.snapshotStatusCell);
        track(this.#axesCell);
        track(this.#sourcesCell);

        const id = glyphId.value;
        if (!id) return null;

        return this.instance(id, location);
      },
      { name: "font.instance" },
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
   * @returns the id-keyed glyph model, or null when the glyph is missing or not loaded.
   */
  #glyphModel(glyphId: GlyphId): Glyph | null {
    if (!this.loaded) return null;

    const directory = this.#directoryCell.peek();
    const record = directory.recordForId(glyphId);
    if (!record) return null;

    return this.#store.glyphModel(glyphId, () => {
      const source = this.defaultSource;
      const layer = directory.layerForGlyphAtSource(glyphId, source.id);
      if (!layer) return null;

      const state = this.layerState(layer.id);
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

    return this.#store.glyphLayerModel(glyphId, source.id, () => {
      const glyph = this.#glyphModel(glyphId);
      if (!glyph) return null;

      const state = glyph.isPrimarySource(source) ? undefined : this.layerState(layer.id);
      return glyph.createGlyphLayer(source, state);
    });
  }

  #glyphGeometry(glyphId: GlyphId, location: AxisLocation): GlyphGeometry {
    const glyph = this.#glyphModel(glyphId);
    if (!glyph) return emptyGlyphGeometry();

    const sourceLocation = axisLocationFromLocation(glyph.primarySourceForFont.location);
    if (axisLocationsEqual(location, sourceLocation, [...this.getAxes()])) {
      return glyph.primaryGeometryForFont;
    }

    const exactSource = this.sourceAt(location);
    if (exactSource) {
      return this.layer(glyphId, exactSource.id)?.geometry ?? emptyGlyphGeometry();
    }

    const variationData = this.variationData(glyphId);
    if (!variationData) {
      return glyph.primaryGeometryForFont;
    }

    const values = interpolate(variationData, normalize(location, [...this.getAxes()]));
    if (values.length === 0) {
      return glyph.primaryGeometryForFont;
    }

    return new GlyphGeometry(glyph.interpolationStructureForFont, values);
  }

  #glyphInstanceInput(glyph: Glyph, location: Signal<AxisLocation>): GlyphInstanceInput {
    return {
      location,
      layer: computed(
        () => {
          const currentLocation = location.value;
          track(this.#directoryCell);
          track(this.#store.snapshotStatusCell);
          track(this.#axesCell);
          track(this.#sourcesCell);

          return this.editableLayerAt(glyph.id, currentLocation);
        },
        { name: "font.instance.layer" },
      ),
      geometry: computed(
        () => {
          const currentLocation = location.value;
          track(this.#directoryCell);
          track(this.#store.snapshotStatusCell);
          track(this.#axesCell);
          track(this.#sourcesCell);

          return this.#glyphGeometry(glyph.id, currentLocation);
        },
        { name: "font.instance.geometry" },
      ),
      outline: this.outline(glyph, location),
    };
  }

  /**
   * Reports whether every authored source for each glyph has local geometry.
   *
   * @param glyphIds - Stable glyph identities to inspect.
   */
  areGlyphsLoaded(glyphIds: readonly GlyphId[]): boolean {
    for (const glyphId of glyphIds) {
      if (!this.glyph(glyphId)) return false;
      for (const sourceId of this.#store.sourceIdsForGlyph(glyphId)) {
        if (this.#store.needsGlyphSource(glyphId, sourceId)) return false;
      }
    }
    return true;
  }

  /**
   * Loads one glyph's geometry.
   *
   * @param glyphId - Stable glyph identity whose local geometry should be available.
   * @param options - Optional source scope; omitted means every authored layer for the glyph.
   * @returns `true` when the glyph exists and is locally available after the load.
   * @see {@link loadGlyphs}
   */
  async loadGlyph(glyphId: GlyphId, options: GlyphLoadOptions = {}): Promise<boolean> {
    return (await this.loadGlyphs([glyphId], options)).has(glyphId);
  }

  /**
   * Requests local glyph geometry and returns the requested glyph ids that are available.
   *
   * @remarks
   * Component bases discovered while reading snapshots are requested as a side
   * effect, but the returned set is keyed only by the glyph IDs requested by the
   * caller.
   *
   * @param glyphIds - Stable glyph identities whose local geometry should be available.
   * @param options - Optional source scope; omitted means every authored layer for each glyph.
   * @returns A fresh set containing requested glyph ids that exist in the current font.
   */
  async loadGlyphs(
    glyphIds: readonly GlyphId[],
    options: GlyphLoadOptions = {},
  ): Promise<ReadonlySet<GlyphId>> {
    await this.#loadGlyphSnapshots(glyphIds, options);

    const loaded = new Set<GlyphId>();
    for (const glyphId of uniqueGlyphIds(glyphIds)) {
      const glyph = this.#glyphModel(glyphId);
      if (glyph) loaded.add(glyphId);
    }
    return loaded;
  }

  async #loadGlyphSnapshots(
    glyphIds: readonly GlyphId[],
    options: GlyphLoadOptions = {},
  ): Promise<void> {
    if (!this.#editCoordinator || glyphIds.length === 0) return;

    await this.#editCoordinator.settled();

    const queue = uniqueGlyphIds(glyphIds);
    const seen = new Set<GlyphId>(queue);

    while (queue.length > 0) {
      const batchGlyphIds = queue.splice(0);
      const inFlight = this.#inFlightLoadsFor(batchGlyphIds, options);
      if (inFlight.length > 0) {
        await Promise.all(inFlight);
      }

      const requests = this.#requestableGlyphs(batchGlyphIds, options);
      if (requests.length > 0) {
        await this.#loadGlyphRequests(requests);
      }

      for (const glyphId of batchGlyphIds) {
        for (const baseGlyphId of this.#store.loadedComponentBaseGlyphIds(glyphId)) {
          if (seen.has(baseGlyphId)) continue;
          seen.add(baseGlyphId);
          queue.push(baseGlyphId);
        }
      }
    }
  }

  #requestableGlyphs(
    glyphIds: readonly GlyphId[],
    options: GlyphLoadOptions,
  ): WorkspaceGlyphSnapshotRequest[] {
    const result: SnapshotRequest[] = [];
    const seen = new Set<GlyphId>();
    for (const glyphId of glyphIds) {
      if (seen.has(glyphId)) continue;
      const sourceIds = this.#neededSourceIds(glyphId, options);
      if (sourceIds.length === 0) continue;
      seen.add(glyphId);
      result.push({ glyphId, sourceIds });
    }
    return result;
  }

  #neededSourceIds(glyphId: GlyphId, options: GlyphLoadOptions): SourceId[] {
    const sourceIds = options.sourceIds ?? this.#store.sourceIdsForGlyph(glyphId);
    const needed: SourceId[] = [];
    const seen = new Set<SourceId>();

    for (const sourceId of sourceIds) {
      if (seen.has(sourceId)) continue;
      seen.add(sourceId);
      if (this.#store.needsGlyphSource(glyphId, sourceId)) needed.push(sourceId);
    }

    return needed;
  }

  #inFlightLoadsFor(glyphIds: readonly GlyphId[], options: GlyphLoadOptions): Promise<void>[] {
    const promises: Promise<void>[] = [];
    const seen = new Set<Promise<void>>();

    for (const glyphId of uniqueGlyphIds(glyphIds)) {
      const sourceIds = options.sourceIds ?? this.#store.sourceIdsForGlyph(glyphId);
      for (const sourceId of sourceIds) {
        const promise = this.#glyphLoadsInFlight.get(inFlightKey(glyphId, sourceId));
        if (!promise || seen.has(promise)) continue;
        seen.add(promise);
        promises.push(promise);
      }
    }

    return promises;
  }

  async #loadGlyphRequests(requests: readonly WorkspaceGlyphSnapshotRequest[]): Promise<void> {
    const promise = this.#readAndApplyGlyphRequests(requests);

    for (const request of requests) {
      for (const sourceId of request.sourceIds) {
        this.#glyphLoadsInFlight.set(inFlightKey(request.glyphId, sourceId), promise);
      }
    }

    try {
      await promise;
    } finally {
      for (const request of requests) {
        for (const sourceId of request.sourceIds) {
          const key = inFlightKey(request.glyphId, sourceId);
          if (this.#glyphLoadsInFlight.get(key) === promise) {
            this.#glyphLoadsInFlight.delete(key);
          }
        }
      }
    }
  }

  async #readAndApplyGlyphRequests(
    requests: readonly WorkspaceGlyphSnapshotRequest[],
  ): Promise<void> {
    if (!this.#editCoordinator) return;

    const load = this.#store.beginGlyphLoad(requests);
    try {
      this.#store.finishGlyphLoad(load, await this.#editCoordinator.readGlyphSnapshots(requests));
    } catch (error) {
      this.#store.failGlyphLoad(load);
      throw error;
    }
  }

  /**
   * Create a reactive composed outline for a glyph.
   *
   * Font supplies glyph, layer, and geometry lookup for component expansion.
   *
   * @returns A new outline object that follows `location`.
   */
  outline(glyph: Glyph, location: Signal<AxisLocation>): GlyphOutline {
    return new GlyphOutline(
      glyph,
      location,
      (glyphId) => {
        track(this.#directoryCell);
        track(this.#store.snapshotStatusCell);

        return this.#glyphModel(glyphId);
      },
      (glyphId, resolvedLocation) => {
        track(this.#directoryCell);
        track(this.#store.snapshotStatusCell);
        track(this.#axesCell);
        track(this.#sourcesCell);

        return this.editableLayerAt(glyphId, resolvedLocation);
      },
      (glyphId, resolvedLocation) => {
        track(this.#directoryCell);
        track(this.#store.snapshotStatusCell);
        track(this.#axesCell);
        track(this.#sourcesCell);

        return this.#glyphGeometry(glyphId, resolvedLocation);
      },
    );
  }

  /**
   * Returns the store-owned layer state for loaded glyph geometry.
   *
   * @param layerId - stable authored layer identity to resolve.
   * @returns the loaded layer state, or null when its glyph snapshot is not loaded.
   */
  layerState(layerId: LayerId): GlyphLayerState | null {
    return this.#store.layerState(layerId);
  }

  variationData(glyphId: GlyphId): GlyphVariationData | null {
    return this.#store.variationData(glyphId);
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
   * @throws {Error} when constructed without a workspace (pure projection
   *   tests) — same not-wired contract as the legacy bridge getter.
   */
  get editCoordinator(): WorkspaceEditCoordinator {
    if (!this.#editCoordinator) {
      throw new Error("editing is not wired to the workspace yet");
    }

    return this.#editCoordinator;
  }

  createSource(name: string, location: Location): SourceId {
    const sourceId = mintSourceId();
    this.editCoordinator.push({
      kind: "createSource",
      createSource: { sourceId, name, location },
    });

    return sourceId;
  }

  /** @knipclassignore — used by VariationPanel component */
  createAxis(
    name: string,
    tag: string,
    min: number,
    def: number,
    max: number,
    hidden: boolean = false,
  ): AxisId {
    const axisId = mintAxisId();
    this.editCoordinator.push({
      kind: "createAxis",
      createAxis: { axisId, name, tag, min, default: def, max, hidden },
    });

    return axisId;
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

  /** @knipclassignore — used by VariationPanel component */
  get sources(): Source[] {
    return this.#sourcesCell.peek();
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

function inFlightKey(glyphId: GlyphId, sourceId: SourceId): InFlightKey {
  return `${glyphId}:${sourceId}` as InFlightKey;
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

function uniqueGlyphIds(glyphIds: readonly GlyphId[]): GlyphId[] {
  return [...new Set(glyphIds)];
}
