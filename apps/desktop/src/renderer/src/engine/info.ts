import type { FontMetadata, FontMetrics } from "@shift/types";
import type { EngineCore } from "@/types/engine";

export class InfoManager {
  #engine: EngineCore;

  constructor(engine: EngineCore) {
    this.#engine = engine;
  }

  getMetadata(): FontMetadata {
    return this.#engine.getMetadata();
  }

  getMetrics(): FontMetrics {
    return this.#engine.getMetrics();
  }

  getGlyphCount(): number {
    return this.#engine.getGlyphCount();
  }

  getGlyphUnicodes(): number[] {
    return this.#engine.getGlyphUnicodes();
  }

  getGlyphSvgPath(unicode: number): string | null {
    return this.#engine.getGlyphSvgPath(unicode);
  }

  getGlyphAdvance(unicode: number): number | null {
    return this.#engine.getGlyphAdvance(unicode);
  }

  getGlyphBbox(unicode: number): [number, number, number, number] | null {
    return this.#engine.getGlyphBbox(unicode);
  }
}
