import type {
  FontMetrics,
  FontMetadata,
  Axis,
  Source,
  GlyphVariationData,
  GlyphVariationReport,
  GlyphRecord,
  GlyphState,
  GlyphName,
  SourceId,
  Unicode,
} from "@shift/types";
import { computed, signal, type WritableSignal, type Signal } from "@/lib/signals/signal";
import { Glyph, type GlyphSource } from "./Glyph";
import { GlyphOutline } from "./GlyphOutline";
import type { GlyphHandle, ShiftBridge } from "@shift/bridge";
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
class GlyphDirectory {
  #glyphDatabase: GlyphInfo = new GlyphInfo(defaultResources);

  readonly records: readonly GlyphRecord[];
  readonly unicodes: readonly Unicode[];

  readonly recordsByName: ReadonlyMap<GlyphName, GlyphRecord> = new Map();
  readonly nameByUnicode: ReadonlyMap<Unicode, GlyphName> = new Map();
  readonly componentBasesByName: ReadonlyMap<GlyphName, readonly GlyphName[]> = new Map();
  readonly dependentsByName: ReadonlyMap<GlyphName, ReadonlySet<GlyphName>> = new Map();

  private constructor(records: readonly GlyphRecord[]) {
    const recordsByName = new Map<GlyphName, GlyphRecord>();
    const nameByUnicode = new Map<Unicode, GlyphName>();
    const componentBasesByName = new Map<GlyphName, readonly GlyphName[]>();
    const dependentsByName = new Map<GlyphName, Set<GlyphName>>();

    for (const record of records) {
      recordsByName.set(record.name, record);

      for (const unicode of record.unicodes) {
        if (!nameByUnicode.has(unicode)) {
          nameByUnicode.set(unicode, record.name);
        }
      }
      componentBasesByName.set(record.name, record.componentBaseGlyphNames);
      for (const baseName of record.componentBaseGlyphNames) {
        let dependents = dependentsByName.get(baseName);
        if (!dependents) {
          dependents = new Set<GlyphName>();
          dependentsByName.set(baseName, dependents);
        }
        dependents.add(record.name);
      }
    }

    this.records = [...records];
    this.unicodes = [...nameByUnicode.keys()].sort((a, b) => a - b);
    this.recordsByName = recordsByName;
    this.nameByUnicode = nameByUnicode;
    this.componentBasesByName = componentBasesByName;
    this.dependentsByName = dependentsByName;
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
   * Builds an empty directory for an unloaded or freshly reset font model.
   *
   * @returns A directory with no committed glyph records.
   */
  static empty(): GlyphDirectory {
    return new GlyphDirectory([]);
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
   * Returns all committed Unicode values in ascending order.
   *
   * @returns A read-only snapshot derived from the current font records.
   */
  allUnicodes(): readonly Unicode[] {
    return this.unicodes;
  }

  /**
   * Returns committed component bases used by a glyph.
   *
   * @param name - Glyph name whose component references should be inspected.
   * @returns Base glyph names from the committed record; empty when absent.
   */
  componentBaseNamesForName(name: GlyphName): readonly GlyphName[] {
    return this.componentBasesByName.get(name) ?? [];
  }

  /**
   * Returns committed glyphs that reference a base glyph as a component.
   *
   * @param name - Base glyph name to reverse-resolve.
   * @returns Sorted dependent glyph names; empty when no committed glyph references it.
   */
  dependentNamesForName(name: GlyphName): readonly GlyphName[] {
    return [...(this.dependentsByName.get(name) ?? [])].sort();
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
  readonly #bridge: ShiftBridge;
  readonly #defaultMetrics: FontMetrics;

  readonly #$loaded: WritableSignal<boolean>;
  readonly #$metrics: WritableSignal<FontMetrics>;
  readonly #$sources: WritableSignal<Source[]>;
  readonly #$unicodes: Signal<Unicode[]>;
  readonly #$glyphRecords: Signal<readonly GlyphRecord[]>;

  readonly #directory = signal(GlyphDirectory.empty());
  readonly #glyphs = new Map<GlyphName, Glyph>();
  readonly #glyphSources = new Map<GlyphSourceKey, GlyphSource>();

  constructor(bridge: ShiftBridge) {
    this.#bridge = bridge;
    this.#defaultMetrics = DEFAULT_FONT_METRICS;
    this.#$loaded = signal(false);
    this.#$metrics = signal<FontMetrics>(this.#defaultMetrics);
    this.#$sources = signal<Source[]>([]);
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
    return this.#$loaded as Signal<boolean>;
  }

  /** @knipclassignore */
  get $metrics() {
    return this.#$metrics as Signal<FontMetrics>;
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
    return this.#bridge.getMetadata();
  }

  get bridge(): ShiftBridge {
    return this.#bridge;
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
   * @remarks
   * Glyphs are keyed by name in the native font model. This method re-keys the
   * glyph through the bridge and replaces its Unicode list, then clears cached
   * glyph models because existing model objects still carry their original
   * identity handle.
   *
   * @param fromName - Existing committed glyph name.
   * @param name - New unique glyph name after trimming whitespace.
   * @param unicodes - Complete Unicode assignment for the renamed glyph.
   * @throws {Error} when `fromName` is missing, `name` is empty, or `name`
   *   already exists.
   */
  updateGlyphIdentity(fromName: GlyphName, name: GlyphName, unicodes: readonly Unicode[]): void {
    this.#bridge.updateGlyphIdentity(fromName, name.trim() as GlyphName, [...unicodes]);
    this.#glyphs.clear();
    this.#glyphSources.clear();
    this.#hydrateFromBridge();
  }

  /**
   * Creates an empty committed glyph at the default source.
   *
   * @remarks
   * If the requested name already exists, a numeric suffix is appended using
   * {@link nextAvailableGlyphName}. The bridge receives an explicit glyph layer
   * mutation so downstream save/export paths see a real committed glyph record,
   * not a UI-only placeholder.
   *
   * @param name - Preferred glyph name. Blank input falls back to `newGlyph`.
   * @returns The handle for the glyph that was actually created.
   * @throws {Error} when the bridge rejects glyph creation.
   */
  createGlyph(name: GlyphName): GlyphHandle {
    const glyphName = this.nextAvailableGlyphName(name);

    const handle = this.glyphHandleForName(glyphName);
    this.#bridge.setXAdvance(
      {
        glyphHandle: handle,
        layerId: this.defaultSource.layerId,
      },
      500,
    );

    this.#glyphs.clear();
    this.#glyphSources.clear();
    this.#hydrateFromBridge();

    return handle;
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

    const cached = this.#glyphs.get(handle.name);
    if (cached) return cached;

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
  glyphState(handle: GlyphHandle, source: Source): GlyphState | null {
    try {
      return this.#bridge.getGlyphState(handle, source.id);
    } catch {
      return null;
    }
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
    return this.#bridge.isVariable();
  }

  /** @knipclassignore — used by VariationPanel component */
  getAxes(): Axis[] {
    return this.#bridge.getAxes();
  }

  /** @knipclassignore — used by VariationPanel component */
  get sources(): Source[] {
    return this.#$sources.peek();
  }

  /** @knipclassignore — used by VariationPanel component */
  getGlyphVariationData(_handle: GlyphHandle): GlyphVariationData | null {
    return null;
  }

  /** @knipclassignore — used by DebugPanel component */
  getGlyphVariationReport(handle: GlyphHandle): GlyphVariationReport | null {
    return this.#bridge.getGlyphVariationReport(handle);
  }

  /** @knipclassignore — used by DebugPanel component */
  getVariationReports(): GlyphVariationReport[] {
    return this.#bridge.getVariationReports();
  }

  create(sourcePath: string, storePath: string): void {
    this.#glyphs.clear();
    this.#glyphSources.clear();
    this.#bridge.createWorkspace(sourcePath, storePath);
    this.#hydrateFromBridge();
  }

  load(path: string, storePath: string): void {
    this.#glyphs.clear();
    this.#glyphSources.clear();
    this.#bridge.openWorkspace(path, storePath);
    this.#hydrateFromBridge();
  }

  async save(path?: string): Promise<number> {
    return path ? this.#bridge.saveWorkspaceAs(path) : this.#bridge.saveWorkspace();
  }

  async export(path: string): Promise<void> {
    await this.#bridge.exportWorkspace({ path, format: "ttf" });
  }

  /** @knipclassignore — called when closing a document */
  close(): void {
    this.#$loaded.set(false);

    this.#glyphs.clear();
    this.#glyphSources.clear();
    this.#directory.set(GlyphDirectory.empty());

    this.#$metrics.set(this.#defaultMetrics);
    this.#$sources.set([]);
  }

  defaultLocation(): AxisLocation {
    return this.isVariable() ? defaultAxisLocation(this.#bridge.getAxes()) : emptyAxisLocation();
  }

  #hydrateFromBridge(): void {
    this.#directory.set(GlyphDirectory.fromRecords(this.#bridge.getGlyphs()));
    this.#$metrics.set(this.#bridge.getMetrics());
    this.#$sources.set(this.#bridge.getSources());
    this.#$loaded.set(true);
  }
}

function glyphSourceKey(name: GlyphName, sourceId: SourceId): GlyphSourceKey {
  return `${sourceId}:${name}` as GlyphSourceKey;
}
