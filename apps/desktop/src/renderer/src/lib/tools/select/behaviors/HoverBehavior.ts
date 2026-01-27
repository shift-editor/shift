import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/createContext";
import type { SelectState, SelectBehavior } from "../types";

export class HoverBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    return (state.type === "ready" || state.type === "selected") && event.type === "pointerMove";
  }

  transition(state: SelectState, event: ToolEvent, ctx: ToolContext): SelectState | null {
    if (event.type !== "pointerMove") return null;
    if (state.type !== "ready" && state.type !== "selected") return null;

    const pos = event.point;
    const point = ctx.hitTest.getPointAt(pos);

    if (point) {
      const pointId = point.id;
      return {
        ...state,
        hoveredPointId: pointId,
        intent: { action: "setHoveredPoint", pointId },
      };
    }

    const segmentHit = ctx.hitTest.getSegmentAt(pos);
    if (segmentHit) {
      return {
        ...state,
        hoveredPointId: null,
        intent: {
          action: "setHoveredSegment",
          indicator: {
            segmentId: segmentHit.segmentId,
            closestPoint: segmentHit.point,
            t: segmentHit.t,
          },
        },
      };
    }

    return {
      ...state,
      hoveredPointId: null,
      intent: { action: "clearHover" },
    };
  }
}
