import type { ToolEventOf } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/Behavior";
import type { SelectHandlerBehavior, SelectState } from "../types";
import { hitTestTextSlot } from "../../text/layout";
import { resolveComponentAtPoint } from "../compositeHitTest";

/**
 * Updates hover indicator on text run glyphs during pointer movement.
 *
 * This is a visual-only behavior — it returns false so that
 * subsequent behaviors can also process the pointer move event.
 */
export class TextRunHoverBehavior implements SelectHandlerBehavior {
  onPointerMove(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"pointerMove">,
  ): boolean {
    if (state.type !== "ready" && state.type !== "selected") return false;

    const textRunState = ctx.editor.getTextRunState();
    if (!textRunState) return false;

    const metrics = ctx.editor.font.getMetrics();
    const hitIndex = hitTestTextSlot(textRunState.layout, event.point, metrics, {
      outlineRadius: ctx.editor.hitRadius,
      includeFill: true,
      requireShape: true,
    });

    ctx.editor.setTextRunHovered(hitIndex);
    const inspection = textRunState.compositeInspection;
    if (!inspection || hitIndex !== inspection.slotIndex) {
      ctx.editor.setTextRunInspectionComponent(null);
      return false;
    }

    const slot = textRunState.layout.slots[inspection.slotIndex];
    if (!slot) {
      ctx.editor.setTextRunInspectionComponent(null);
      return false;
    }

    const composite = ctx.editor.getGlyphCompositeComponents(slot.glyph.glyphName);
    const localPoint = { x: event.point.x - slot.x, y: event.point.y };
    const hitComponent = resolveComponentAtPoint(composite, localPoint);
    ctx.editor.setTextRunInspectionComponent(hitComponent?.index ?? null);

    // Do not consume pointerMove -- later behaviors still need it.
    return false;
  }
}
