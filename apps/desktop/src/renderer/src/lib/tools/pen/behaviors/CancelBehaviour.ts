import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/createContext";
import type { PenState, PenBehavior } from "../types";

export class CancelBehaviour implements PenBehavior {
  canHandle(state: PenState, event: ToolEvent): boolean {
    return state.type === "ready" && event.type === "keyDown" && event.key === "Escape";
  }

  transition(state: PenState, event: ToolEvent, ctx: ToolContext): PenState | null {
    if (state.type !== "ready") return null;
    if (event.type !== "keyDown" || event.key !== "Escape") return null;

    if (this.hasActiveDrawingContour(ctx)) {
      return {
        ...state,
        intent: { action: "abandonContour" },
      };
    }

    return null;
  }

  private hasActiveDrawingContour(ctx: ToolContext): boolean {
    const snapshot = ctx.edit.getGlyph();
    if (!snapshot) return false;

    const activeContourId = ctx.edit.getActiveContourId();
    const activeContour = snapshot.contours.find((c) => c.id === activeContourId);

    return activeContour !== undefined && !activeContour.closed && activeContour.points.length > 0;
  }
}
