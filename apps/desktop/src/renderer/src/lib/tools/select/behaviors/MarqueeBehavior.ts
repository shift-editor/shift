import type { PointId, Rect2D } from "@shift/types";
import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/createContext";
import type { SelectState, SelectBehavior } from "../types";
import type { IRenderer } from "@/types/graphics";
import { normalizeRect, pointInRect } from "../utils";
import { SELECTION_RECTANGLE_STYLES } from "@/lib/styles/style";
import { asPointId } from "@shift/types";

export class MarqueeBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    if (state.type === "selecting") {
      return event.type === "drag" || event.type === "dragEnd" || event.type === "dragCancel";
    }
    if ((state.type === "ready" || state.type === "selected") && event.type === "dragStart") {
      return true;
    }
    return false;
  }

  transition(state: SelectState, event: ToolEvent, ctx: ToolContext): SelectState | null {
    if (state.type === "selecting") {
      return this.transitionSelecting(state, event, ctx);
    }

    if ((state.type === "ready" || state.type === "selected") && event.type === "dragStart") {
      return this.tryStartMarquee(state, event, ctx);
    }

    return null;
  }

  render(renderer: IRenderer, state: SelectState, ctx: ToolContext): void {
    if (state.type !== "selecting") return;

    const rect = normalizeRect(state.selection.startPos, state.selection.currentPos);
    renderer.setStyle(SELECTION_RECTANGLE_STYLES);
    renderer.lineWidth = ctx.screen.lineWidth(SELECTION_RECTANGLE_STYLES.lineWidth);
    renderer.fillRect(rect.x, rect.y, rect.width, rect.height);
    renderer.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }

  private transitionSelecting(
    state: SelectState & { type: "selecting" },
    event: ToolEvent,
    ctx: ToolContext,
  ): SelectState {
    if (event.type === "drag") {
      const rect = normalizeRect(state.selection.startPos, event.point);

      return {
        type: "selecting",
        selection: { ...state.selection, currentPos: event.point },
        intent: { action: "selectPointsInRect", rect },
      };
    }

    if (event.type === "dragEnd") {
      const rect = normalizeRect(state.selection.startPos, state.selection.currentPos);
      const pointIds = this.getPointsInRect(rect, ctx);

      if (pointIds.size > 0) {
        return {
          type: "selected",
          hoveredPointId: null,
          intent: { action: "setSelectionMode", mode: "committed" },
        };
      }
      return {
        type: "ready",
        hoveredPointId: null,
        intent: { action: "setSelectionMode", mode: "committed" },
      };
    }

    if (event.type === "dragCancel") {
      return {
        type: "ready",
        hoveredPointId: null,
        intent: { action: "clearSelection" },
      };
    }

    return state;
  }

  private tryStartMarquee(
    state: SelectState & { type: "ready" | "selected" },
    event: ToolEvent & { type: "dragStart" },
    ctx: ToolContext,
  ): SelectState | null {
    const point = ctx.hitTest.getPointAt(event.point);
    if (point) return null;

    const segmentHit = ctx.hitTest.getSegmentAt(event.point);
    if (segmentHit) return null;

    if (state.type === "selected") {
      return {
        type: "selecting",
        selection: { startPos: event.point, currentPos: event.point },
        intent: { action: "clearAndStartMarquee" },
      };
    }

    return {
      type: "selecting",
      selection: { startPos: event.point, currentPos: event.point },
      intent: { action: "setSelectionMode", mode: "preview" },
    };
  }

  private getPointsInRect(rect: Rect2D, ctx: ToolContext): Set<PointId> {
    const allPoints = ctx.hitTest.getAllPoints();
    const hitPoints = allPoints.filter((p) => pointInRect(p, rect));
    return new Set(hitPoints.map((p) => asPointId(p.id)));
  }
}
