import type { FontMetadata, FontMetrics } from "@shift/types";
import type { EngineCore } from "@/types/engine";

export class InfoManager {
  #engine: EngineCore;

  constructor(engine: EngineCore) {
    this.#engine = engine;
  }

  getMetadata(): FontMetadata {
    return this.#engine.native.getMetadata();
  }

  getMetrics(): FontMetrics {
    return this.#engine.native.getMetrics();
  }

  getGlyphCount(): number {
    return this.#engine.native.getGlyphCount();
  }

  getGlyphUnicodes(): number[] {
    return this.#engine.native.getGlyphUnicodes();
  }

  getGlyphSvgPath(unicode: number): string | null {
    return this.#engine.native.getGlyphSvgPath(unicode);
  }

  getGlyphAdvance(unicode: number): number | null {
    return this.#engine.native.getGlyphAdvance(unicode);
  }

  getGlyphBbox(unicode: number): [number, number, number, number] | null {
    return this.#engine.native.getGlyphBbox(unicode);
  }
}
