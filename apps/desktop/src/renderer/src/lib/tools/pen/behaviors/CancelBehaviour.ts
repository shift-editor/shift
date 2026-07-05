import type { ToolContext } from "../../core/Behavior";
import type { KeyDownEvent } from "../../core/GestureDetector";
import type { PenState, PenBehavior } from "../types";
import { PenStroke } from "../PenStroke";
import type { Pen } from "../Pen";

export class EscapeBehavior implements PenBehavior {
  onKeyDown(state: PenState, ctx: ToolContext<PenState, Pen>, event: KeyDownEvent): boolean {
    if (state.type !== "ready") return false;
    if (event.key !== "Escape") return false;

    if (this.hasActiveDrawingContour(ctx)) {
      ctx.tool.clearActiveContour();
      return true;
    }

    return false;
  }

  private hasActiveDrawingContour(ctx: ToolContext<PenState, Pen>): boolean {
    const contour = PenStroke.active(ctx.tool)?.activeContour ?? null;
    if (!contour) return false;
    return !contour.closed && !contour.isEmpty;
  }
}
