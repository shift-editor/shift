import type { ToolEventOf } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/Behavior";
import type { SelectHandlerBehavior, SelectState } from "../types";
import { hitTestTextSlot, type GlyphRef } from "../../text/layout";
import { resolveComponentAtPoint } from "../compositeHitTest";

/**
 * Handles double-click on a text run glyph to switch it to in-place editing.
 *
 * Takes priority over the normal double-click-select-contour behavior
 * when a text run is active.
 */
export class TextRunEditBehavior implements SelectHandlerBehavior {
  onDoubleClick(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"doubleClick">,
  ): boolean {
    if (state.type !== "ready" && state.type !== "selected") return false;

    let textRunState = ctx.editor.getTextRunState();
    if (!textRunState) {
      const activeName = ctx.editor.getActiveGlyphName();
      if (!activeName) return false;
      ctx.editor.ensureTextRunSeed({
        glyphName: activeName,
        unicode: ctx.editor.getActiveGlyphUnicode(),
      });
      ctx.editor.recomputeTextRun(ctx.editor.getDrawOffset().x);
      textRunState = ctx.editor.getTextRunState();
    }
    if (!textRunState) return false;

    const metrics = ctx.editor.font.getMetrics();
    const hitIndex = hitTestTextSlot(textRunState.layout, event.point, metrics, {
      outlineRadius: ctx.editor.hitRadius,
      includeFill: true,
      requireShape: true,
    });
    if (hitIndex === null) {
      if (textRunState.compositeInspection !== null) {
        ctx.editor.clearTextRunInspection();
        return true;
      }
      return false;
    }

    const slot = textRunState.layout.slots[hitIndex];
    if (!slot) return true;

    const composite = ctx.editor.getGlyphCompositeComponents(slot.glyph.glyphName);
    const isComposite = !!composite && composite.components.length > 0;
    const isInspected = textRunState.compositeInspection?.slotIndex === hitIndex;

    if (isComposite && !isInspected) {
      ctx.editor.setTextRunInspectionSlot(hitIndex);
      ctx.editor.setTextRunInspectionComponent(null);
      ctx.editor.setTextRunEditingSlot(null);
      return true;
    }

    const localPoint = { x: event.point.x - slot.x, y: event.point.y };
    const hit = resolveComponentAtPoint(composite, localPoint);
    const hitComponent = hit?.component ?? null;

    if (hitComponent) {
      const insertedGlyph: GlyphRef = {
        glyphName: hitComponent.componentGlyphName,
        unicode: hitComponent.sourceUnicodes[0] ?? null,
      };

      const insertedIndex = hitIndex + 1;
      ctx.editor.insertTextGlyphAt(insertedIndex, insertedGlyph);
      ctx.editor.recomputeTextRun();

      const nextState = ctx.editor.getTextRunState();
      const insertedSlot = nextState?.layout.slots[insertedIndex];
      const slotX = insertedSlot?.x ?? slot.x;

      ctx.editor.startEditSession(insertedGlyph);
      ctx.editor.setDrawOffsetForGlyph({ x: slotX, y: 0 }, insertedGlyph);
      ctx.editor.setPreviewMode(false);
      ctx.editor.setTextRunEditingSlot(insertedIndex, insertedGlyph);
      ctx.editor.clearTextRunInspection();
      return true;
    }

    if (isComposite) {
      ctx.editor.setTextRunInspectionComponent(null);
      return true;
    }

    ctx.editor.startEditSession(slot.glyph);
    ctx.editor.setDrawOffsetForGlyph({ x: slot.x, y: 0 }, slot.glyph);
    ctx.editor.setPreviewMode(false);
    ctx.editor.setTextRunEditingSlot(hitIndex, slot.glyph);
    ctx.editor.clearTextRunInspection();
    return true;
  }
}
