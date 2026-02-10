import type { FontMetrics, FontMetadata } from "@shift/types";
import type { Bounds } from "@shift/geo";
import type { Font } from "../Font";

/** Dependency interface for {@link FontManager}. Provides raw font data access. */
export interface FontSource {
  getMetrics(): FontMetrics;
  getMetadata(): FontMetadata;
  getSvgPath(unicode: number): string | null;
  getAdvance(unicode: number): number | null;
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

  getSvgPath(unicode: number): string | null {
    return this.#deps.getSvgPath(unicode);
  }

  getAdvance(unicode: number): number | null {
    return this.#deps.getAdvance(unicode);
  }

  getBbox(unicode: number): Bounds | null {
    return this.#deps.getBbox(unicode);
  }
}
