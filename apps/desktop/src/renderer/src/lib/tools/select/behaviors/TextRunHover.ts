import type { ToolEventOf } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/Behavior";
import type { SelectBehavior, SelectState } from "../types";
import { hitTestTextSlot } from "../../text/layout";
import { resolveComponentAtPoint } from "@/lib/editor/hit/composite";

/**
 * Updates hover indicator on text run glyphs during pointer movement.
 *
 * This is a visual-only behavior — it returns false so that
 * subsequent behaviors can also process the pointer move event.
 */
export class TextRunHover implements SelectBehavior {
  onPointerMove(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"pointerMove">,
  ): boolean {
    if (state.type !== "ready" && state.type !== "selected") return false;

    const ctrl = ctx.editor.textRunController;
    const textRunState = ctrl.state.value;
    if (!textRunState) return false;

    const metrics = ctx.editor.font.getMetrics();
    const hitIndex = hitTestTextSlot(textRunState.layout, event.point, metrics, ctx.editor.font, {
      outlineRadius: ctx.editor.hitRadius,
      includeFill: true,
      requireShape: true,
    });

    ctrl.setHovered(hitIndex);
    const inspection = textRunState.compositeInspection;
    if (!inspection || hitIndex !== inspection.slotIndex) {
      ctrl.setInspectionHoveredComponent(null);
      return false;
    }

    const slot = textRunState.layout.slots[inspection.slotIndex];
    if (!slot) {
      ctrl.setInspectionHoveredComponent(null);
      return false;
    }

    const composite = ctx.editor.getGlyphCompositeComponents(slot.glyph.glyphName);
    const localPoint = { x: event.point.x - slot.x, y: event.point.y };
    const hitComponent = resolveComponentAtPoint(composite, localPoint);
    ctrl.setInspectionHoveredComponent(hitComponent?.index ?? null);

    return false;
  }
}
