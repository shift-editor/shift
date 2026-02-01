import type { PointId, Rect2D } from "@shift/types";
import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { SelectState, SelectBehavior } from "../types";
import type { DrawAPI } from "../../core/DrawAPI";
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

  transition(state: SelectState, event: ToolEvent, editor: ToolContext): SelectState | null {
    if (state.type === "selecting") {
      return this.transitionSelecting(state, event, editor);
    }

    if ((state.type === "ready" || state.type === "selected") && event.type === "dragStart") {
      return this.tryStartMarquee(state, event, editor);
    }

    return null;
  }

  render(draw: DrawAPI, state: SelectState, _editor: ToolContext): void {
    if (state.type !== "selecting") return;

    const rect = normalizeRect(state.selection.startPos, state.selection.currentPos);
    draw.rect(
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      {
        fillStyle: SELECTION_RECTANGLE_STYLES.fillStyle,
        strokeStyle: SELECTION_RECTANGLE_STYLES.strokeStyle,
        strokeWidth: SELECTION_RECTANGLE_STYLES.lineWidth,
      },
    );
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
  ): SelectState {
    if (event.type === "drag") {
      // No intent on drag; commit on dragEnd to avoid per-frame selection cost.
      return {
        type: "selecting",
        selection: { ...state.selection, currentPos: event.point },
      };
    }

    if (event.type === "dragEnd") {
      const rect = normalizeRect(state.selection.startPos, state.selection.currentPos);
      const pointIds = this.getPointsInRect(rect, editor);

      if (pointIds.size > 0) {
        return {
          type: "selected",
          intent: { action: "selectPointsInRect", rect },
        };
      }
      return {
        type: "ready",
        intent: { action: "selectPointsInRect", rect },
      };
    }

    if (event.type === "dragCancel") {
      return {
        type: "ready",
        intent: { action: "clearSelection" },
      };
    }

    return state;
  }

  private tryStartMarquee(
    state: SelectState & { type: "ready" | "selected" },
    event: ToolEvent & { type: "dragStart" },
    editor: ToolContext,
  ): SelectState | null {
    const hit = editor.getNodeAt(event.point);
    if (hit !== null) return null;

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

  private getPointsInRect(rect: Rect2D, editor: ToolContext): Set<PointId> {
    const allPoints = editor.getAllPoints();
    const hitPoints = allPoints.filter((p) => pointInRect(p, rect));
    return new Set(hitPoints.map((p) => asPointId(p.id)));
  }
}
