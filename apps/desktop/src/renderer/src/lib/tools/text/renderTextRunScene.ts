/**
 * Shared text run scene rendering — called from tool renderInScene hooks.
 *
 * Renders text run glyph silhouettes, selection highlights, cursor, hover
 * outlines, and composite inspection overlays in viewport (scene) space.
 */
import type { DrawAPI } from "../core/DrawAPI";
import type { EditorAPI } from "../core/EditorAPI";
import { renderTextRun } from "@/lib/editor/rendering/passes/textRun";
import type { CompositeInspectionRenderData } from "@/lib/editor/rendering/passes/textRun";
import type { TextRunRenderState } from "./TextRunController";

export function renderTextRunInScene(editor: EditorAPI, draw: DrawAPI): void {
  const textRunState = editor.textRunController.state.value;
  if (!textRunState) return;

  const ctx = draw.renderer;
  const metrics = editor.font.getMetrics();
  const glyph = editor.glyph.peek();
  const activeGlyphName = editor.getActiveGlyphName();

  const liveGlyph =
    glyph && activeGlyphName
      ? {
          name: activeGlyphName,
          unicode: editor.getActiveGlyphUnicode(),
          contours: glyph.contours,
          compositeContours: glyph.compositeContours,
        }
      : null;

  const inspection = resolveCompositeInspection(editor, textRunState);

  renderTextRun(
    {
      ctx,
      pxToUpm: (px?: number) => draw.pxToUpm(px),
      applyStyle: (style) => {
        if (style.lineWidth) ctx.lineWidth = draw.pxToUpm(style.lineWidth);
        if (style.strokeStyle) ctx.strokeStyle = style.strokeStyle;
        if (style.fillStyle) ctx.fillStyle = style.fillStyle;
      },
    },
    textRunState,
    metrics,
    liveGlyph,
    inspection,
  );
}

function resolveCompositeInspection(
  editor: EditorAPI,
  textRunState: TextRunRenderState,
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
