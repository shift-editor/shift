import type { FontMetrics, FontMetadata, CompositeGlyph } from "@shift/types";
import type { Bounds } from "@shift/geo";
import { signal, type WritableSignal, type Signal } from "@/lib/reactive/signal";
import type { NativeBridge } from "@/bridge";
import { getGlyphInfo } from "@/store/glyphInfo";

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

  /** Resolve unicode to glyph name. Checks font first, then glyph-info DB, then fallback. */
  glyphName(unicode: number): string {
    return (
      this.#bridge.nameForUnicode(unicode) ??
      getGlyphInfo().getGlyphName(unicode) ??
      `uni${unicode.toString(16).padStart(4, "0").toUpperCase()}`
    );
  }

  getAdvance(name: string): number | null {
    return this.#bridge.getAdvance(name);
  }

  getBbox(name: string): Bounds | null {
    return this.#bridge.getBbox(name);
  }

  getSvgPath(name: string): string | null {
    return this.#bridge.getSvgPath(name);
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
  }

  async save(path: string): Promise<void> {
    return this.#bridge.saveFontAsync(path);
  }

  /** @knipclassignore — called when closing a document */
  reset(): void {
    this.#$loaded.set(false);
    this.#$unicodes.set([]);
    this.#$metrics.set(null);
  }
}
