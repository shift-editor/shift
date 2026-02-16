import type { FontMetrics, FontMetadata } from "@shift/types";
import type { Bounds } from "@shift/geo";
import type { Font } from "../Font";

/** Dependency interface for {@link FontManager}. Provides raw font data access. */
export interface FontSource {
  getMetrics(): FontMetrics;
  getMetadata(): FontMetadata;
  getSvgPathByName(glyphName: string): string | null;
  getSvgPath(unicode: number): string | null;
  getAdvanceByName(glyphName: string): number | null;
  getAdvance(unicode: number): number | null;
  getBboxByName(glyphName: string): Bounds | null;
  getBbox(unicode: number): Bounds | null;
}

/**
 * Manages font data access through a dependency interface.
 *
 * Wraps a {@link FontSource} to implement the {@link Font} interface that
 * tools and UI consumers read from via `editor.font.*`.
 */
export class FontManager implements Font {
  readonly #deps: FontSource;

  constructor(deps: FontSource) {
    this.#deps = deps;
  }

  getMetrics(): FontMetrics {
    return this.#deps.getMetrics();
  }

  getMetadata(): FontMetadata {
    return this.#deps.getMetadata();
  }

  getSvgPathByName(glyphName: string): string | null {
    return this.#deps.getSvgPathByName(glyphName);
  }

  getSvgPath(unicode: number): string | null {
    return this.#deps.getSvgPath(unicode);
  }

  getAdvanceByName(glyphName: string): number | null {
    return this.#deps.getAdvanceByName(glyphName);
  }

  getAdvance(unicode: number): number | null {
    return this.#deps.getAdvance(unicode);
  }

  getBboxByName(glyphName: string): Bounds | null {
    return this.#deps.getBboxByName(glyphName);
  }

  getBbox(unicode: number): Bounds | null {
    return this.#deps.getBbox(unicode);
  }
}
