import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import { getPointIdFromHit } from "@/types/hitResult";
import { Validate } from "@shift/validation";

export class ToggleSmooth implements SelectBehavior {
  onDoubleClick(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"doubleClick">,
  ): boolean {
    if (state.type !== "ready" && state.type !== "selected") return false;

    const hit = ctx.editor.hitTest(event.coords);
    const pointId = getPointIdFromHit(hit);
    if (pointId === null) return false;

    const point = ctx.editor.getAllPoints().find((p) => p.id === pointId);
    if (!point || !Validate.isOnCurve(point)) return false;

    const glyph = ctx.editor.glyph.peek();
    if (!glyph) return false;

    glyph.toggleSmooth(pointId);
    return true;
  }
}
