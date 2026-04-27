import type {
  FontMetrics,
  FontMetadata,
  CompositeGlyph,
  Axis,
  AxisLocation,
  Source,
  GlyphVariationData,
} from "@shift/types";
import type { MasterSnapshot } from "@shift/types";
import type { Bounds } from "@shift/geo";
import { signal, type WritableSignal, type Signal } from "@/lib/reactive/signal";
import type { NativeBridge } from "@/bridge";
import { getGlyphInfo } from "@/store/glyphInfo";
import { LruCache } from "@/lib/utils/LruCache";
import { GlyphView } from "./GlyphView";

const GLYPH_CACHE_CAPACITY = 256;

/**
 * Reactive font data surface.
 *
 * Auto-unwrapping getters (same pattern as Glyph). Reading `font.metrics`,
 * `font.unicodes`, `font.loaded` inside a computed/effect auto-tracks.
 */
export class Font {
  readonly #bridge: NativeBridge;
  readonly #$loaded: WritableSignal<boolean>;
  readonly #$unicodes: WritableSignal<number[]>;
  readonly #$metrics: WritableSignal<FontMetrics | null>;
  readonly #$variationLocation: WritableSignal<AxisLocation>;

  readonly #glyphs: LruCache<string, GlyphView>;

  constructor(bridge: NativeBridge) {
    this.#bridge = bridge;
    this.#$loaded = signal(false);
    this.#$unicodes = signal<number[]>([]);
    this.#$metrics = signal<FontMetrics | null>(null);
    this.#$variationLocation = signal<AxisLocation>({});
    this.#glyphs = new LruCache<string, GlyphView>(GLYPH_CACHE_CAPACITY, (g) => g.dispose());
  }

  /** @knipclassignore */
  get loaded(): boolean {
    return this.#$loaded.value;
  }

  /** @knipclassignore */
  get unicodes(): number[] {
    return this.#$unicodes.value;
  }

  /** @knipclassignore */
  get metrics(): FontMetrics | null {
    return this.#$metrics.value;
  }

  /** Raw signals for React hooks that need Signal<T>. */
  /** @knipclassignore */
  get $loaded() {
    return this.#$loaded as Signal<boolean>;
  }

  /** @knipclassignore */
  get $unicodes() {
    return this.#$unicodes as Signal<number[]>;
  }

  /** @knipclassignore */
  get $metrics() {
    return this.#$metrics as Signal<FontMetrics | null>;
  }

  /** @knipclassignore */
  get metadata(): FontMetadata {
    return this.#bridge.getMetadata();
  }

  /** Sync metrics fetch (non-null, call only when font is loaded). */
  getMetrics(): FontMetrics {
    return this.#bridge.getMetrics();
  }

  getPath(name: string): Path2D | null {
    return this.#bridge.getPath(name);
  }

  nameForUnicode(unicode: number): string | null {
    return this.#bridge.nameForUnicode(unicode);
  }

  glyph(name: string): GlyphView | null {
    const cached = this.#glyphs.get(name);
    if (cached) return cached;

    const data = this.#bridge.getGlyphData(name);
    if (!data) return null;

    const g = new GlyphView(
      name,
      data.geometry,
      data.variationData,
      data.components,
      this.getAxes(),
      this.#$variationLocation,
      this,
    );

    this.#glyphs.set(name, g);
    return g;
  }

  /** Resolve unicode to glyph name. Checks font first, then glyph-info DB, then fallback. */
  glyphName(unicode: number): string {
    return (
      this.#bridge.nameForUnicode(unicode) ??
      getGlyphInfo().getGlyphName(unicode) ??
      `uni${unicode.toString(16).padStart(4, "0").toUpperCase()}`
    );
  }

  getBbox(name: string): Bounds | null {
    return this.#bridge.getBbox(name);
  }

  /** @knipclassignore — used by GlyphPreview for variation interpolation */
  get $variationLocation(): Signal<AxisLocation> {
    return this.#$variationLocation;
  }

  /** @knipclassignore — used by useVariationLocation */
  setVariationLocation(location: AxisLocation): void {
    this.#$variationLocation.set(location);
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
  getSources(): Source[] {
    return this.#bridge.getSources();
  }

  /** @knipclassignore — used by VariationPanel component */
  getGlyphMasterSnapshots(glyphName: string): MasterSnapshot[] | null {
    return this.#bridge.getGlyphMasterSnapshots(glyphName);
  }

  /** @knipclassignore — used by VariationPanel component */
  getGlyphVariationData(glyphName: string): GlyphVariationData | null {
    return this.#bridge.getGlyphVariationData(glyphName);
  }

  composites(glyphName: string): CompositeGlyph | null {
    return this.#bridge.getGlyphCompositeComponents(glyphName) as CompositeGlyph | null;
  }

  load(path: string): void {
    this.#bridge.loadFont(path);
    const unicodes = this.#bridge.getGlyphUnicodes();
    const metrics = this.#bridge.getMetrics();
    this.#$unicodes.set(unicodes);
    this.#$metrics.set(metrics);
    this.#$variationLocation.set(this.#defaultLocation());
    this.#$loaded.set(true);
  }

  async save(path: string): Promise<void> {
    return this.#bridge.saveFontAsync(path);
  }

  /** @knipclassignore — called when closing a document */
  reset(): void {
    this.#glyphs.clear();
    this.#$loaded.set(false);
    this.#$unicodes.set([]);
    this.#$metrics.set(null);
    this.#$variationLocation.set({});
  }

  #defaultLocation(): AxisLocation {
    if (!this.isVariable()) return {};
    const out: AxisLocation = {};
    for (const axis of this.#bridge.getAxes()) out[axis.tag] = axis.default;
    return out;
  }
}
