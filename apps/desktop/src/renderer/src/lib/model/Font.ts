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

  static fromRecords(records: readonly GlyphRecord[]): GlyphDirectory {
    return new GlyphDirectory(records);
  }

  static empty(): GlyphDirectory {
    return new GlyphDirectory([]);
  }

  nameForUnicode(unicode: Unicode): GlyphName {
    const nameFromFont = this.nameByUnicode.get(unicode);
    if (nameFromFont) return nameFromFont;

    const nameFromDatabase = this.#glyphDatabase.getGlyphName(unicode);
    if (nameFromDatabase) return nameFromDatabase;

    const fallbackName = fallbackGlyphNameForUnicode(unicode);
    return fallbackName as GlyphName;
  }

  /** @knipclassignore — public glyph directory API. */
  hasGlyph(name: GlyphName): boolean {
    return this.recordsByName.has(name);
  }

  /** @knipclassignore — public glyph directory API. */
  recordForName(name: GlyphName): GlyphRecord | null {
    return this.recordsByName.get(name) ?? null;
  }

  /** @knipclassignore — public glyph directory API. */
  unicodesForName(name: GlyphName): readonly Unicode[] {
    return this.recordsByName.get(name)?.unicodes ?? [];
  }

  /** @knipclassignore — public glyph directory API. */
  primaryUnicodeForName(name: GlyphName): Unicode | null {
    return this.unicodesForName(name)[0] ?? null;
  }

  allUnicodes(): readonly Unicode[] {
    return this.unicodes;
  }

  componentBaseNamesForName(name: GlyphName): readonly GlyphName[] {
    return this.componentBasesByName.get(name) ?? [];
  }

  dependentNamesForName(name: GlyphName): readonly GlyphName[] {
    return [...(this.dependentsByName.get(name) ?? [])].sort();
  }

  glyphHandleForName(name: GlyphName): GlyphHandle | null {
    const record = this.recordForName(name);
    if (!record) return null;
    const unicode = this.primaryUnicodeForName(name);
    return unicode === null ? { name } : { name, unicode };
  }

  glyphHandleForUnicode(unicode: Unicode): GlyphHandle | null {
    const name = this.nameForUnicode(unicode);
    return name ? { name, unicode } : null;
  }
}

type GlyphSourceKey = string & { readonly __glyphSourceKey: unique symbol };

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

  readonly #directory = signal(GlyphDirectory.empty());
  readonly #glyphs = new Map<GlyphName, Glyph>();
  readonly #glyphSources = new Map<GlyphSourceKey, GlyphSource>();

  constructor(bridge: ShiftBridge) {
    this.#bridge = bridge;
    this.#defaultMetrics = bridge.getMetrics();
    this.#$loaded = signal(false);
    this.#$metrics = signal<FontMetrics>(this.#defaultMetrics);
    this.#$sources = signal<Source[]>([]);
    this.#$unicodes = computed(() => [...this.#directory.value.unicodes]);
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

  /** @knipclassignore */
  get metadata(): FontMetadata {
    return this.#bridge.getMetadata();
  }

  get bridge(): ShiftBridge {
    return this.#bridge;
  }

  glyphRecords(): readonly GlyphRecord[] {
    return this.#directory.peek().records;
  }

  nameForUnicode(unicode: Unicode): GlyphName {
    return this.#directory.peek().nameForUnicode(unicode);
  }

  /** @knipclassignore — public glyph directory API. */
  hasGlyph(name: GlyphName): boolean {
    return this.#directory.peek().hasGlyph(name);
  }

  /** @knipclassignore — public glyph directory API. */
  recordForName(name: GlyphName): GlyphRecord | null {
    return this.#directory.peek().recordForName(name);
  }

  /** @knipclassignore — public glyph directory API. */
  unicodesForName(name: GlyphName): readonly Unicode[] {
    return this.#directory.peek().unicodesForName(name);
  }

  /** @knipclassignore — public glyph directory API. */
  primaryUnicodeForName(name: GlyphName): Unicode | null {
    return this.#directory.peek().primaryUnicodeForName(name);
  }

  componentBaseNamesForName(name: GlyphName): readonly GlyphName[] {
    return this.#directory.peek().componentBaseNamesForName(name);
  }

  dependentNamesForName(name: GlyphName): readonly GlyphName[] {
    return this.#directory.peek().dependentNamesForName(name);
  }

  glyphHandleForName(name: GlyphName): GlyphHandle | null {
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
   * @throws {Error} when `fromName` is missing, `name` is empty, `name` already
   *   exists, or an edit session is active.
   */
  updateGlyphIdentity(fromName: GlyphName, name: GlyphName, unicodes: readonly Unicode[]): void {
    this.#bridge.updateGlyphIdentity(fromName, name.trim() as GlyphName, [...unicodes]);
    this.#glyphs.clear();
    this.#glyphSources.clear();
    this.#hydrateFromBridge();
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
   * This is a read/data access API. It asks the bridge for committed or active
   * glyph state at the font's default source and returns `null` when no state
   * exists. It does not create missing glyphs and does not start an edit session.
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
   * bridge may return active edit-session state, committed font state, or
   * `null` when the glyph has no data for the source.
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

  create(): void {
    this.#glyphs.clear();
    this.#glyphSources.clear();
    this.#bridge.createFont();
    this.#hydrateFromBridge();
  }

  load(path: string): void {
    this.#glyphs.clear();
    this.#glyphSources.clear();
    this.#bridge.loadFont(path);
    this.#hydrateFromBridge();
  }

  async save(path: string): Promise<number> {
    return this.#bridge.saveFont(path);
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
