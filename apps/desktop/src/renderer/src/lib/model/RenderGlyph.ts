import type { Bounds } from "@shift/geo";
import type { RenderGlyph as RenderGlyphContract } from "@/types/glyphRender";
import type { GlyphRenderModel } from "./Glyph";

/** Source-independent selected-glyph view backed by the live renderer model. */
export class RenderGlyph implements RenderGlyphContract {
  readonly #view: GlyphRenderModel;

  constructor(view: GlyphRenderModel) {
    this.#view = view;
  }

  get drawPath(): Path2D {
    return this.#view.drawPath;
  }

  get bounds(): Bounds | null {
    return this.#view.bounds;
  }

  get xAdvance(): number {
    return this.#view.xAdvance;
  }
}
