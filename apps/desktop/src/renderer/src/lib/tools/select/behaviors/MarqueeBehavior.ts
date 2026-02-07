import type { PointId, Rect2D } from "@shift/types";
import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { TransitionResult } from "../../core/Behavior";
import type { SelectState, SelectBehavior } from "../types";
import type { SelectAction } from "../actions";
import { normalizeRect, pointInRect } from "../utils";

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

  transition(
    state: SelectState,
    event: ToolEvent,
    editor: ToolContext,
  ): TransitionResult<SelectState, SelectAction> | null {
    if (state.type === "selecting") {
      return this.transitionSelecting(state, event, editor);
    }

    if ((state.type === "ready" || state.type === "selected") && event.type === "dragStart") {
      return this.tryStartMarquee(state, event, editor);
    }

    return null;
  }

  onTransition(prev: SelectState, next: SelectState, _event: ToolEvent, editor: ToolContext): void {
    if (next.type === "selecting") {
      const rect = normalizeRect(next.selection.startPos, next.selection.currentPos);
      editor.setMarqueePreviewRect(rect);
    } else if (prev.type === "selecting") {
      editor.setMarqueePreviewRect(null);
    }
    if (prev.type === "selecting" && (next.type === "selected" || next.type === "ready")) {
      editor.setSelectionMode("committed");
    }
  }

  private transitionSelecting(
    state: SelectState & { type: "selecting" },
    event: ToolEvent,
    editor: ToolContext,
  ): TransitionResult<SelectState, SelectAction> {
    if (event.type === "drag") {
      return {
        state: {
          type: "selecting",
          selection: { ...state.selection, currentPos: event.point },
        },
      };
    }

    if (event.type === "dragEnd") {
      const rect = normalizeRect(state.selection.startPos, state.selection.currentPos);
      const pointIds = this.getPointsInRect(rect, editor);

      if (pointIds.size > 0) {
        return {
          state: { type: "selected" },
          action: { type: "selectPointsInRect", rect },
        };
      }
      return {
        state: { type: "ready" },
        action: { type: "selectPointsInRect", rect },
      };
    }

    if (event.type === "dragCancel") {
      return {
        state: { type: "ready" },
        action: { type: "clearSelection" },
      };
    }

    return { state };
  }

  private tryStartMarquee(
    state: SelectState & { type: "ready" | "selected" },
    event: ToolEvent & { type: "dragStart" },
    editor: ToolContext,
  ): TransitionResult<SelectState, SelectAction> | null {
    const hit = editor.getNodeAt(event.point);
    if (hit !== null) return null;

    if (state.type === "selected") {
      return {
        state: {
          type: "selecting",
          selection: { startPos: event.point, currentPos: event.point },
        },
        action: { type: "clearAndStartMarquee" },
      };
    }

    return {
      state: {
        type: "selecting",
        selection: { startPos: event.point, currentPos: event.point },
      },
      action: { type: "setSelectionMode", mode: "preview" },
    };
  }

  private getPointsInRect(rect: Rect2D, editor: ToolContext): Set<PointId> {
    const allPoints = editor.getAllPoints();
    const hitPoints = allPoints.filter((p) => pointInRect(p, rect));
    return new Set(hitPoints.map((p) => p.id));
  }
}
