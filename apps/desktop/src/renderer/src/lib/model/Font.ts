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
import type { GlyphHandle, ShiftBridge } from "@shift/bridge";
import {
  axisLocationDistanceSquared,
  axisLocationFromLocation,
  axisLocationsEqual,
  defaultAxisLocation,
  emptyAxisLocation,
} from "@/lib/variation/location";
import type { AxisLocation } from "@/types/variation";

class GlyphDirectory {
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

  nameForUnicode(unicode: Unicode): GlyphName | null {
    return this.nameByUnicode.get(unicode) ?? null;
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
 * Reactive font data surface.
 *
 * Auto-unwrapping getters (same pattern as Glyph). Reading `font.metrics`,
 * `font.unicodes`, `font.loaded` inside a computed/effect auto-tracks.
 *
 * Owns glyph identity and glyph-source registries, lazily seeded from the
 * bridge. Glyphs are cached by name. Editable glyph sources are cached by
 * glyph name plus source id.
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
    return this.#$loaded.value;
  }

  /** @knipclassignore */
  get metrics(): FontMetrics {
    return this.#$metrics.value;
  }

  /** @knipclassignore */
  get unicodes(): readonly Unicode[] {
    return this.#directory.value.unicodes;
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
    return this.#directory.value.records;
  }

  nameForUnicode(unicode: Unicode): GlyphName | null {
    return this.#directory.value.nameForUnicode(unicode);
  }

  /** @knipclassignore — public glyph directory API. */
  hasGlyph(name: GlyphName): boolean {
    return this.#directory.value.hasGlyph(name);
  }

  /** @knipclassignore — public glyph directory API. */
  recordForName(name: GlyphName): GlyphRecord | null {
    return this.#directory.value.recordForName(name);
  }

  /** @knipclassignore — public glyph directory API. */
  unicodesForName(name: GlyphName): readonly Unicode[] {
    return this.#directory.value.unicodesForName(name);
  }

  /** @knipclassignore — public glyph directory API. */
  primaryUnicodeForName(name: GlyphName): Unicode | null {
    return this.#directory.value.primaryUnicodeForName(name);
  }

  componentBaseNamesForName(name: GlyphName): readonly GlyphName[] {
    return this.#directory.value.componentBaseNamesForName(name);
  }

  dependentNamesForName(name: GlyphName): readonly GlyphName[] {
    return this.#directory.value.dependentNamesForName(name);
  }

  glyphHandleForName(name: GlyphName): GlyphHandle | null {
    return this.#directory.value.glyphHandleForName(name);
  }

  glyphHandleForUnicode(unicode: Unicode): GlyphHandle | null {
    return this.#directory.value.glyphHandleForUnicode(unicode);
  }

  glyph(handle: GlyphHandle): Glyph | null {
    const cached = this.#glyphs.get(handle.name);
    if (cached) return cached;

    const source = this.defaultSource();
    if (!source) return null;
    const state = this.glyphState(handle, source);
    if (!state) return null;

    const glyph = new Glyph(this, handle, source, state);
    this.#glyphs.set(handle.name, glyph);
    return glyph;
  }

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

  glyphState(handle: GlyphHandle, source: Source): GlyphState | null {
    try {
      return this.#bridge.getGlyphState(handle, source.id);
    } catch {
      return null;
    }
  }

  defaultSource(): Source | null {
    return this.sourceAt(this.defaultLocation()) ?? this.sources[0] ?? null;
  }

  source(sourceId: SourceId): Source | null {
    const sources = this.sources;

    for (const source of sources) {
      if (source.id === sourceId) {
        return source;
      }
    }

    return null;
  }

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

  sourceAtOrDefault(location: AxisLocation): Source | null {
    return this.sourceAt(location) ?? this.defaultSource();
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
    return this.#$sources.value;
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

  load(path: string): void {
    this.#glyphs.clear();
    this.#glyphSources.clear();
    this.#bridge.loadFont(path);

    this.#directory.set(GlyphDirectory.fromRecords(this.#bridge.getGlyphs()));
    this.#$metrics.set(this.#bridge.getMetrics());
    this.#$sources.set(this.#bridge.getSources());

    this.#$loaded.set(true);
  }

  async save(path: string): Promise<number> {
    return this.#bridge.saveFont(path);
  }

  /** @knipclassignore — called when closing a document */
  reset(): void {
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
}

function glyphSourceKey(name: GlyphName, sourceId: SourceId): GlyphSourceKey {
  return `${sourceId}:${name}` as GlyphSourceKey;
}
