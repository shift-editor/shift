import type { FontMetadata, FontMetrics } from "@shift/types";
import { Bounds } from "@shift/geo";
import type { CompositeComponentsPayload } from "@shared/bridge/FontEngineAPI";

/** Read-only access to font-level metadata, metrics, and per-glyph properties. */
export interface Info {
  getMetadata(): FontMetadata;
  getMetrics(): FontMetrics;
  getGlyphCount(): number;
  getGlyphUnicodes(): number[];
  getGlyphNameForUnicode(unicode: number): string | null;
  getGlyphUnicodesForName(glyphName: string): number[];
  getDependentUnicodes(unicode: number): number[];
  getDependentUnicodesByName(glyphName: string): number[];
  getGlyphSvgPath(unicode: number): string | null;
  getGlyphSvgPathByName(glyphName: string): string | null;
  getGlyphAdvance(unicode: number): number | null;
  getGlyphAdvanceByName(glyphName: string): number | null;
  getGlyphBbox(unicode: number): Bounds | null;
  getGlyphBboxByName(glyphName: string): Bounds | null;
  getGlyphCompositeComponents(glyphName: string): CompositeComponentsPayload | null;
}

/**
 * Thin pass-through so consumers can depend on `engine.info` without accessing editing or session capabilities.
 * All methods implement the `Info` interface and are consumed via `FontEngine.info`.
 * @knipclassignore
 */
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

  getGlyphNameForUnicode(unicode: number): string | null {
    return this.#engine.getGlyphNameForUnicode(unicode);
  }

  getGlyphUnicodesForName(glyphName: string): number[] {
    return this.#engine.getGlyphUnicodesForName(glyphName);
  }

  getDependentUnicodes(unicode: number): number[] {
    return this.#engine.getDependentUnicodes(unicode);
  }

  getDependentUnicodesByName(glyphName: string): number[] {
    return this.#engine.getDependentUnicodesByName(glyphName);
  }

  getGlyphSvgPath(unicode: number): string | null {
    return this.#engine.getGlyphSvgPath(unicode);
  }

  getGlyphSvgPathByName(glyphName: string): string | null {
    return this.#engine.getGlyphSvgPathByName(glyphName);
  }

  getGlyphAdvance(unicode: number): number | null {
    return this.#engine.getGlyphAdvance(unicode);
  }

  getGlyphAdvanceByName(glyphName: string): number | null {
    return this.#engine.getGlyphAdvanceByName(glyphName);
  }

  getGlyphBbox(unicode: number): Bounds | null {
    return this.#engine.getGlyphBbox(unicode);
  }

  getGlyphBboxByName(glyphName: string): Bounds | null {
    return this.#engine.getGlyphBboxByName(glyphName);
  }

  getGlyphCompositeComponents(glyphName: string): CompositeComponentsPayload | null {
    return this.#engine.getGlyphCompositeComponents(glyphName);
  }
}
