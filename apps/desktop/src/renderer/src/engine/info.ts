import type { FontMetadata, FontMetrics } from "@shift/types";
import { Bounds } from "@shift/geo";

/** Read-only access to font-level metadata, metrics, and per-glyph properties. */
export interface Info {
  getMetadata(): FontMetadata;
  getMetrics(): FontMetrics;
  getGlyphCount(): number;
  getGlyphUnicodes(): number[];
  getGlyphSvgPath(unicode: number): string | null;
  getGlyphAdvance(unicode: number): number | null;
  getGlyphBbox(unicode: number): Bounds | null;
}

/** Thin pass-through so consumers can depend on `engine.info` without accessing editing or session capabilities. */
export class InfoManager {
  #engine: Info;

  constructor(engine: Info) {
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

  getGlyphBbox(unicode: number): Bounds | null {
    return this.#engine.getGlyphBbox(unicode);
  }
}
