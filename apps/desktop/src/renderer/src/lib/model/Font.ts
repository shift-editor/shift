import type { FontMetrics, FontMetadata, CompositeGlyph, Axis, Source } from "@shift/types";
import type { MasterSnapshot } from "@/lib/interpolation/interpolate";
import type { InterpolationResult } from "@/bridge/NativeBridge";
import type { Bounds } from "@shift/geo";
import { signal, type WritableSignal, type Signal } from "@/lib/reactive/signal";
import type { NativeBridge } from "@/bridge";
import { getGlyphInfo } from "@/store/glyphInfo";
import { Variation } from "./Variation";
import { snapshotToSvgPath } from "@/lib/interpolation/svg";

/**
 * Reactive font data surface.
 *
 * When a variable font is loaded, `font.variation` provides the
 * interpolation engine. `getPath()` and `getAdvance()` transparently
 * return interpolated results when a variation location is active.
 */
export class Font {
  readonly #bridge: NativeBridge;
  readonly #$loaded: WritableSignal<boolean>;
  readonly #$unicodes: WritableSignal<number[]>;
  readonly #$metrics: WritableSignal<FontMetrics | null>;
  variation: Variation | null = null;

  constructor(bridge: NativeBridge) {
    this.#bridge = bridge;
    this.#$loaded = signal(false);
    this.#$unicodes = signal<number[]>([]);
    this.#$metrics = signal<FontMetrics | null>(null);
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

  /** @knipclassignore */
  get $loaded(): Signal<boolean> {
    return this.#$loaded as Signal<boolean>;
  }

  /** @knipclassignore */
  get $unicodes(): Signal<number[]> {
    return this.#$unicodes as Signal<number[]>;
  }

  /** @knipclassignore */
  get $metrics(): Signal<FontMetrics | null> {
    return this.#$metrics as Signal<FontMetrics | null>;
  }

  /** @knipclassignore */
  get metadata(): FontMetadata {
    return this.#bridge.getMetadata();
  }

  getMetrics(): FontMetrics {
    return this.#bridge.getMetrics();
  }

  getPath(name: string): Path2D | null {
    if (!this.variation) return this.#bridge.getPath(name);

    const snap = this.variation.interpolate(name);
    if (!snap) return this.#bridge.getPath(name);

    const svg = snapshotToSvgPath(snap);
    if (!svg) return this.#bridge.getPath(name);

    return new Path2D(svg);
  }

  nameForUnicode(unicode: number): string | null {
    return this.#bridge.nameForUnicode(unicode);
  }

  glyphName(unicode: number): string {
    return (
      this.#bridge.nameForUnicode(unicode) ??
      getGlyphInfo().getGlyphName(unicode) ??
      `uni${unicode.toString(16).padStart(4, "0").toUpperCase()}`
    );
  }

  getAdvance(name: string): number | null {
    if (!this.variation) return this.#bridge.getAdvance(name);

    const snap = this.variation.interpolate(name);
    if (!snap) return this.#bridge.getAdvance(name);

    return snap.xAdvance;
  }

  getBbox(name: string): Bounds | null {
    return this.#bridge.getBbox(name);
  }

  getSvgPath(name: string): string | null {
    if (!this.variation) return this.#bridge.getSvgPath(name);

    const snap = this.variation.interpolate(name);
    if (!snap) return this.#bridge.getSvgPath(name);

    return snapshotToSvgPath(snap) || this.#bridge.getSvgPath(name);
  }

  /** @knipclassignore */
  isVariable(): boolean {
    return this.#bridge.isVariable();
  }

  /** @knipclassignore */
  getAxes(): Axis[] {
    return this.#bridge.getAxes();
  }

  /** @knipclassignore */
  getSources(): Source[] {
    return this.#bridge.getSources();
  }

  /** @knipclassignore */
  getGlyphMasterSnapshots(glyphName: string): MasterSnapshot[] | null {
    return this.#bridge.getGlyphMasterSnapshots(glyphName);
  }

  /** @knipclassignore */
  interpolateGlyph(
    glyphName: string,
    location: Record<string, number>,
  ): InterpolationResult | null {
    return this.#bridge.interpolateGlyph(glyphName, location);
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
    this.#$loaded.set(true);

    this.variation = this.#bridge.isVariable() ? new Variation(this.#bridge) : null;
  }

  async save(path: string): Promise<void> {
    return this.#bridge.saveFontAsync(path);
  }

  /** @knipclassignore */
  reset(): void {
    this.#$loaded.set(false);
    this.#$unicodes.set([]);
    this.#$metrics.set(null);
    this.variation = null;
  }
}
