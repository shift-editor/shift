import type { GlyphRenderModel } from "./Glyph";
import type { RenderGlyph } from "@/types/glyphRender";

/** Projects the authored render model onto the source-independent canvas boundary. */
export function renderGlyph(view: GlyphRenderModel): RenderGlyph {
  return {
    drawPath: view.drawPath,
    bounds: view.bounds,
    xAdvance: view.xAdvance,
  };
}
