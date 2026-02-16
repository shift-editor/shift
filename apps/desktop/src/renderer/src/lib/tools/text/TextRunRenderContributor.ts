import type { ToolRenderContributor } from "../core/ToolRenderContributor";
import { renderTextRun } from "@/lib/editor/rendering/passes/textRun";
import type { CompositeInspectionRenderData } from "@/lib/editor/rendering/passes/textRun";
import type { TextRunState } from "@/lib/editor/managers/TextRunManager";
import type { EditorAPI } from "../core/EditorAPI";

function resolveCompositeInspection(
  editor: EditorAPI,
  textRunState: TextRunState,
): CompositeInspectionRenderData | null {
  const inspection = textRunState.compositeInspection;
  if (!inspection) return null;

  const slot = textRunState.layout.slots[inspection.slotIndex];
  if (!slot) return null;

  const composite = editor.getGlyphCompositeComponents(slot.glyph.glyphName);
  if (!composite || composite.components.length === 0) return null;

  return {
    slotIndex: inspection.slotIndex,
    hoveredComponentIndex: inspection.hoveredComponentIndex,
    components: composite.components,
  };
}

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
    const activeGlyphName = editor.getActiveGlyphName();
    const liveGlyph =
      glyph && activeGlyphName
        ? {
            glyphName: activeGlyphName,
            contours: glyph.contours,
            compositeContours: glyph.compositeContours,
          }
        : null;

    renderTextRun(
      {
        ctx: draw.renderer,
        lineWidthUpm,
      },
      textRunState,
      metrics,
      liveGlyph,
      resolveCompositeInspection(editor, textRunState),
    );
  },
};
