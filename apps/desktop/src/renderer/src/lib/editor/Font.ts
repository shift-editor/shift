import type { FontMetrics, FontMetadata, CompositeGlyph } from "@shift/types";
import type { Bounds } from "@shift/geo";
import type { NativeBridge } from "@/bridge";

/**
 * Read-only font data surface exposed to tools and UI.
 *
 * Wraps the internal NativeBridge for font-level queries.
 * Never exposes editing operations — those live on Glyph.
 */
export class Font {
  readonly #bridge: NativeBridge;

  constructor(bridge: NativeBridge) {
    this.#bridge = bridge;
  }

  getMetrics(): FontMetrics {
    return this.#bridge.getMetrics();
  }

  /** @knipclassignore — used by UI components */
  getMetadata(): FontMetadata {
    return this.#bridge.getMetadata();
  }

  getPath(name: string): Path2D | null {
    return this.#bridge.getPath(name);
  }

  nameForUnicode(unicode: number): string | null {
    return this.#bridge.nameForUnicode(unicode);
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
  }

  async save(path: string): Promise<void> {
    return this.#bridge.saveFontAsync(path);
  }
}
