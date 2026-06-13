import type {
  FontMetrics,
  FontMetadata,
  Axis,
  Source,
  GlyphId,
  GlyphRecord,
  GlyphState,
  GlyphName,
  SourceId,
  Unicode,
} from "@shift/types";
import { mintGlyphId } from "@shift/types";
import { computed, type Signal } from "@/lib/signals/signal";
import type { ChangeWriter } from "@/lib/workspace/ChangeWriter";
import type { WorkspaceSnapshot } from "@shared/workspace/protocol";
import { Glyph, type GlyphSource } from "./Glyph";
import { GlyphOutline } from "./GlyphOutline";
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
  readonly nameById: ReadonlyMap<GlyphId, GlyphName> = new Map();
  readonly nameByUnicode: ReadonlyMap<Unicode, GlyphName> = new Map();
  readonly componentBasesById: ReadonlyMap<GlyphId, readonly GlyphId[]> = new Map();
  readonly dependentsById: ReadonlyMap<GlyphId, ReadonlySet<GlyphId>> = new Map();

  private constructor(records: readonly GlyphRecord[]) {
    const recordsByName = new Map<GlyphName, GlyphRecord>();
    const nameById = new Map<GlyphId, GlyphName>();
    const nameByUnicode = new Map<Unicode, GlyphName>();
    const componentBasesById = new Map<GlyphId, readonly GlyphId[]>();
    const dependentsById = new Map<GlyphId, Set<GlyphId>>();

    for (const record of records) {
      recordsByName.set(record.name, record);
      nameById.set(record.id, record.name);

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
    this.nameById = nameById;
    this.nameByUnicode = nameByUnicode;
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
   * Reports whether the current font has a committed glyph with this name.
   *
   * @param name - Glyph name to test against committed font records.
   * @returns `true` only for glyphs present in the loaded font, not database fallbacks.
   * @knipclassignore
   */
  hasGlyph(name: GlyphName): boolean {
    return this.recordsByName.has(name);
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

type GlyphSourceKey = string & { readonly __glyphSourceKey: unique symbol };

const DEFAULT_FONT_METRICS: FontMetrics = {
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  capHeight: 700,
  xHeight: 500,
};

/**
 * Reactive domain model for the loaded font.
 *
 * `Font` owns font-level metadata, source lookup, glyph identity lookup, and
 * cached glyph models. Getters such as `metrics`, `unicodes`, and `sources`
 * are signal-backed: reading them inside a computed or effect subscribes to
 * later font loads/resets.
 *
 * A glyph handle is only an identity. It may name a glyph that is not committed
 * in the font yet. Use {@link glyph} for existing glyph data, and use the
 * editor edit/open API when the caller intends to create or edit source data.
 */
export class Font {
  readonly #$loaded: Signal<boolean>;
  readonly #$metrics: Signal<FontMetrics>;
  readonly #$metadata: Signal<FontMetadata>;
  readonly #$sources: Signal<Source[]>;
  readonly #$axes: Signal<Axis[]>;
  readonly #$unicodes: Signal<Unicode[]>;
  readonly #$glyphRecords: Signal<readonly GlyphRecord[]>;

  readonly #directory: Signal<GlyphDirectory>;
  readonly #glyphs = new Map<GlyphName, Glyph>();
  /** Open glyph models keyed by stable id; survives directory re-keys. */
  readonly #glyphsById = new Map<GlyphId, Glyph>();
  readonly #glyphSources = new Map<GlyphSourceKey, GlyphSource>();
  readonly #writer: ChangeWriter | null;
  #cachesKeyedTo: GlyphDirectory | null = null;

  /**
   * Projects the renderer's workspace snapshot into the font domain model.
   *
   * @param $workspace - Single source of workspace truth owned by
   *   `WorkspaceClient`. There is no load: every derived value follows this
   *   signal, and `null` means no font is open.
   */
  constructor($workspace: Signal<WorkspaceSnapshot | null>, writer?: ChangeWriter) {
    this.#writer = writer ?? null;
    this.#$loaded = computed(() => $workspace.value !== null);
    this.#$metrics = computed(() => $workspace.value?.metrics ?? DEFAULT_FONT_METRICS);
    this.#$metadata = computed(() => $workspace.value?.metadata ?? {});
    this.#$sources = computed(() => $workspace.value?.sources ?? []);
    this.#$axes = computed(() => $workspace.value?.axes ?? []);
    this.#directory = computed(() => GlyphDirectory.fromRecords($workspace.value?.glyphs ?? []));
    this.#$unicodes = computed(() => [...this.#directory.value.unicodes]);
    this.#$glyphRecords = computed(() => this.#directory.value.records);
  }

  /** @knipclassignore */
  get loaded(): boolean {
    return this.#$loaded.peek();
  }

  /** @knipclassignore */
  get metrics(): FontMetrics {
    return this.#$metrics.peek();
  }

  /** @knipclassignore */
  get unicodes(): readonly Unicode[] {
    return this.#directory.peek().unicodes;
  }

  /** Raw signals for React hooks that need Signal<T>. */
  /** @knipclassignore */
  get $loaded() {
    return this.#$loaded;
  }

  /** @knipclassignore */
  get $metrics() {
    return this.#$metrics;
  }

  /** @knipclassignore */
  get $unicodes(): Signal<Unicode[]> {
    return this.#$unicodes;
  }

  /** Reactive committed glyph directory records for UI lists and grids. */
  get glyphRecordsCell(): Signal<readonly GlyphRecord[]> {
    return this.#$glyphRecords;
  }

  /** @knipclassignore */
  get metadata(): FontMetadata {
    return this.#$metadata.peek();
  }

  /**
   * Returns committed glyph records from the current font snapshot.
   *
   * @returns A read-only record list rebuilt after load, create, rename, or reset.
   */
  glyphRecords(): readonly GlyphRecord[] {
    return this.#directory.peek().records;
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
    return this.#directory.peek().nameForUnicode(unicode);
  }

  /**
   * Reports whether the current font has a committed glyph with this name.
   *
   * @param name - Glyph name to test against committed font records.
   * @returns `true` only for glyphs present in the loaded font.
   * @knipclassignore
   */
  hasGlyph(name: GlyphName): boolean {
    return this.#directory.peek().hasGlyph(name);
  }

  /**
   * Returns the committed glyph record for a name.
   *
   * @param name - Glyph name to look up in the font directory.
   * @returns The committed record, or `null` when the font does not contain the glyph.
   * @knipclassignore
   */
  recordForName(name: GlyphName): GlyphRecord | null {
    return this.#directory.peek().recordForName(name);
  }

  /**
   * Returns the committed Unicode assignments for a glyph name.
   *
   * @param name - Glyph name to look up in the font directory.
   * @returns A read-only assignment list; empty when the glyph is missing or unencoded.
   * @knipclassignore
   */
  unicodesForName(name: GlyphName): readonly Unicode[] {
    return this.#directory.peek().unicodesForName(name);
  }

  /**
   * Returns the first committed Unicode assignment for a glyph name.
   *
   * @param name - Glyph name to look up in the font directory.
   * @returns The primary codepoint, or `null` when the glyph is missing or unencoded.
   * @knipclassignore
   */
  primaryUnicodeForName(name: GlyphName): Unicode | null {
    return this.#directory.peek().primaryUnicodeForName(name);
  }

  /**
   * Returns committed component bases used by a glyph.
   *
   * @param name - Glyph name whose component references should be inspected.
   * @returns Base glyph names from the committed record; empty when absent.
   */
  componentBaseNamesForName(name: GlyphName): readonly GlyphName[] {
    return this.#directory.peek().componentBaseNamesForName(name);
  }

  /**
   * Returns committed glyphs that reference a base glyph as a component.
   *
   * @param name - Base glyph name to reverse-resolve.
   * @returns Sorted dependent glyph names; empty when no committed glyph references it.
   */
  dependentNamesForName(name: GlyphName): readonly GlyphName[] {
    return this.#directory.peek().dependentNamesForName(name);
  }

  /**
   * Resolve a glyph name to an editor handle, even when the glyph is not yet
   * committed in the font.
   *
   * @remarks
   * Name-first flows such as New Glyph need a stable handle before source data
   * exists. Existing font records provide their committed Unicode assignment;
   * otherwise the glyph database is used as a best-effort Unicode hint.
   *
   * @param name - Production glyph name to open, create, or query.
   * @returns A glyph identity handle. The handle may refer to a missing glyph.
   */
  glyphHandleForName(name: GlyphName): GlyphHandle {
    return this.#directory.peek().glyphHandleForName(name);
  }

  /**
   * Updates an existing glyph's name and Unicode assignment.
   *
   * @throws {Error} always — glyph mutations return with workspace change sets.
   */
  updateGlyphIdentity(_fromName: GlyphName, _name: GlyphName, _unicodes: readonly Unicode[]): void {
    throw new Error("editing is not wired to the workspace yet");
  }

  /**
   * Creates an empty glyph with one layer per source and returns its
   * identity immediately.
   *
   * @remarks
   * The durable commit happens asynchronously; the committed record folds
   * into the font's directory when the workspace echo lands. Reads that
   * resolve glyph state (e.g. {@link openGlyph}) serialize behind pending
   * writes, so they may follow this call without awaiting anything.
   *
   * @param name - Preferred glyph name. Existing names are auto-incremented
   *   (`base`, `base.1`, …); Unicode assignment is inferred from the
   *   resolved name.
   * @returns The created glyph's record, carrying its freshly minted id.
   */
  createGlyph(name: GlyphName): GlyphRecord {
    const finalName = this.nextAvailableGlyphName(name);
    const handle = this.glyphHandleForName(finalName);
    const unicodes = handle.unicode === undefined ? [] : [handle.unicode];
    const glyphId = mintGlyphId();

    this.writer.push({
      kind: "createGlyph",
      createGlyph: { glyphId, name: finalName, unicodes },
    });

    return { id: glyphId, name: finalName, unicodes, componentBaseGlyphIds: [] };
  }

  /**
   * Finds the next unused glyph name for an auto-incrementing base name.
   *
   * @param name - Preferred base name. Blank input falls back to `newGlyph`.
   * @returns The base name when unused, otherwise `base.1`, `base.2`, and so on.
   */
  nextAvailableGlyphName(name: GlyphName): GlyphName {
    const baseName = (name.trim() || "newGlyph") as GlyphName;
    if (!this.hasGlyph(baseName)) return baseName;

    for (let index = 1; ; index += 1) {
      const candidate = `${baseName}.${index}` as GlyphName;
      if (!this.hasGlyph(candidate)) return candidate;
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
   * // `handle` is suitable for opening or creating the glyph source.
   * ```
   *
   * @returns A glyph identity for the codepoint. This does not load or create glyph geometry.
   */
  glyphHandleForUnicode(unicode: Unicode): GlyphHandle {
    const name = this.nameForUnicode(unicode);
    return { name, unicode };
  }

  /**
   * Get the cached model for an existing glyph.
   *
   * This is a read/data access API. It asks the bridge for glyph state at the
   * font's default source and returns `null` when no state exists. It does not
   * create missing glyphs or select an editable source.
   *
   * @example
   * ```ts
   * const glyph = font.glyph(handle)
   * const outline = glyph?.outlineAt(location)
   * ```
   *
   * @returns The glyph model, or `null` when the glyph has no state for the default source.
   */
  glyph(handle: GlyphHandle): Glyph | null {
    if (!this.loaded) return null;

    this.#syncCaches();

    const cached = this.#glyphs.get(handle.name);
    if (cached) return cached;

    // Open models survive directory re-keys under their stable id; re-link
    // the name cache after #syncCaches cleared it.
    const record = this.#directory.peek().recordForName(handle.name);
    const openModel = record ? this.#glyphsById.get(record.id) : undefined;
    if (openModel) {
      this.#glyphs.set(handle.name, openModel);
      return openModel;
    }

    const source = this.defaultSource;
    const state = this.glyphState(handle, source);
    if (!state) return null;

    const glyph = new Glyph(this, handle, source, state);
    this.#glyphs.set(handle.name, glyph);
    return glyph;
  }

  /**
   * Get editable data for a glyph at an exact source.
   *
   * A source is a glyph at a designspace location. This method returns the
   * source-specific editable model when both the source and glyph state exist.
   * It does not choose a fallback source and does not create missing glyph data.
   *
   * @example
   * ```ts
   * const source = font.defaultSource
   * const glyphSource = font.glyphSource(handle, source)
   * ```
   *
   * @returns The editable glyph source, or `null` when the source/glyph state is unavailable.
   */
  glyphSource(handle: GlyphHandle, source: Source): GlyphSource | null {
    if (!this.source(source.id)) return null;

    this.#syncCaches();

    const key = glyphSourceKey(handle.name, source.id);
    const cached = this.#glyphSources.get(key);
    if (cached) return cached;

    const glyph = this.glyph(handle);
    if (!glyph) return null;

    const state = glyph.isPrimarySource(source) ? undefined : this.glyphState(handle, source);
    const glyphSource = glyph.createGlyphSource(source, state);
    if (!glyphSource) return null;

    this.#glyphSources.set(key, glyphSource);
    return glyphSource;
  }

  /**
   * Create a reactive composed outline for a glyph.
   *
   * Font owns glyph lookup, so component expansion is rooted here instead of
   * passing resolver callbacks through individual glyphs.
   *
   * @returns A new outline object that follows `location`.
   */
  outline(glyph: Glyph, location: Signal<AxisLocation>): GlyphOutline {
    return new GlyphOutline(glyph, location, this);
  }

  /**
   * Read raw glyph state for a source from the bridge.
   *
   * This is the lowest-level glyph data read used by the domain model. The
   * bridge may return native glyph-layer state or `null` when the glyph has no
   * data for the source.
   *
   * @returns Raw glyph state, or `null` when the bridge cannot provide state.
   */
  glyphState(_handle: GlyphHandle, _source: Source): GlyphState | null {
    // Geometry is not part of the workspace snapshot yet; "no state" is the
    // honest answer for every glyph until change sets land.
    return null;
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

    for (const source of sources) {
      if (source.id === sourceId) {
        return source;
      }
    }

    return null;
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
    const axes = this.getAxes();
    const sources = this.sources;

    for (const source of sources) {
      const sourceLocation = axisLocationFromLocation(source.location);
      if (axisLocationsEqual(sourceLocation, location, axes)) {
        return source;
      }
    }

    return null;
  }

  /**
   * Find an exact source for a location, or fall back to the default source.
   *
   * This is useful for UI bootstrapping where a fresh/static font should still
   * resolve to its editable default source even when the current location does
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
   * The renderer's single durable-write path; editing verbs push intents
   * through it.
   *
   * @throws {Error} when constructed without a workspace (pure projection
   *   tests) — same not-wired contract as the legacy bridge getter.
   */
  get writer(): ChangeWriter {
    if (!this.#writer) {
      throw new Error("editing is not wired to the workspace yet");
    }

    return this.#writer;
  }

  /**
   * Opens (or returns the cached) editable glyph model, pulling
   * replace-grade state from the workspace.
   *
   * @remarks
   * Models are cached by stable GlyphId, so open sessions survive directory
   * re-keys and renames. Returns null when the glyph or layer is missing.
   */
  async openGlyph(glyphId: GlyphId, source: Source): Promise<Glyph | null> {
    const cached = this.#glyphsById.get(glyphId);
    if (cached) return cached;

    const record = this.#directory.peek().records.find((entry) => entry.id === glyphId);
    if (!record) return null;

    const state = await this.writer.glyph(glyphId, source.id);
    if (!state) return null;

    const handle = this.#directory.peek().glyphHandleForName(record.name);
    const glyph = new Glyph(this, handle, source, state, glyphId);

    this.#glyphsById.set(glyphId, glyph);
    this.#glyphs.set(record.name, glyph);
    return glyph;
  }

  /**
   * Opens (or returns the cached) editable glyph source at any source,
   * pulling replace-grade state from the workspace.
   *
   * @remarks
   * This is the async entry point for non-primary sources; once opened, the
   * sync {@link glyphSource} resolves from cache (instance resolution,
   * tools). Echoes for the source's layer fold into the opened state.
   */
  async openGlyphSource(glyphId: GlyphId, source: Source): Promise<GlyphSource | null> {
    const glyph =
      this.#glyphsById.get(glyphId) ?? (await this.openGlyph(glyphId, this.defaultSource));
    if (!glyph) return null;

    const cached = this.glyphSource(glyph.handle, source);
    if (cached) return cached;

    const state = await this.writer.glyph(glyphId, source.id);
    if (!state) return null;

    const glyphSource = glyph.createGlyphSource(source, state);
    if (!glyphSource) return null;

    this.#glyphSources.set(glyphSourceKey(glyph.handle.name, source.id), glyphSource);
    return glyphSource;
  }

  /** @knipclassignore — used by VariationPanel component */
  getAxes(): Axis[] {
    return this.#$axes.peek();
  }

  /** @knipclassignore — used by VariationPanel component */
  get sources(): Source[] {
    return this.#$sources.peek();
  }

  /** Drops cached glyph models when the directory they were built from changes. */
  #syncCaches(): void {
    const directory = this.#directory.peek();
    if (this.#cachesKeyedTo === directory) return;

    this.#glyphs.clear();
    this.#glyphSources.clear();
    this.#cachesKeyedTo = directory;
  }

  defaultLocation(): AxisLocation {
    return this.isVariable() ? defaultAxisLocation(this.getAxes()) : emptyAxisLocation();
  }
}

function glyphSourceKey(name: GlyphName, sourceId: SourceId): GlyphSourceKey {
  return `${sourceId}:${name}` as GlyphSourceKey;
}
