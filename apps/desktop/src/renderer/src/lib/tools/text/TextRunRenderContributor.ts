import type { ToolRenderContributor } from "../core/ToolRenderContributor";
import { renderTextRun } from "@/lib/editor/rendering/passes/textRun";

export const textRunRenderContributor: ToolRenderContributor = {
  id: "text-run",
  layer: "static-scene-before-handles",
  visibility: "always",
  render({ editor, draw, lineWidthUpm }) {
    if (!draw) return;

    const textRunState = editor.getTextRunState();
    if (!textRunState) return;

    const metrics = editor.font.getMetrics();
    const glyph = editor.glyph.peek();
    const activeUnicode = editor.getActiveGlyphUnicode();
    const drawOffset = editor.getDrawOffset();
    const liveGlyph =
      glyph && activeUnicode !== null
        ? { unicode: activeUnicode, x: drawOffset.x, contours: glyph.contours }
        : null;

    renderTextRun(
      {
        ctx: draw.renderer,
        lineWidthUpm,
      },
      textRunState,
      metrics,
      liveGlyph,
    );
  },
};
