import type { Point2D } from "@shift/types";
import { Vec2 } from "@shift/geo";
import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { TransitionResult } from "../../core/Behavior";
import type { PenState, PenBehavior, AnchorData, HandleData } from "../types";
import type { PenAction } from "../actions";
import { AddPointCommand, InsertPointCommand } from "@/lib/commands";
import type { DragSnapSession } from "@/lib/editor/snapping/types";

const DRAG_THRESHOLD = 3;

export class HandleBehavior implements PenBehavior {
  #snap: DragSnapSession | null = null;

  canHandle(state: PenState, event: ToolEvent): boolean {
    if (state.type === "anchored") {
      return (
        event.type === "drag" ||
        event.type === "dragEnd" ||
        event.type === "dragCancel" ||
        event.type === "keyDown"
      );
    }
    if (state.type === "dragging") {
      return (
        event.type === "drag" ||
        event.type === "dragEnd" ||
        event.type === "dragCancel" ||
        event.type === "keyDown"
      );
    }
    return false;
  }

  transition(
    state: PenState,
    event: ToolEvent,
    editor: ToolContext,
  ): TransitionResult<PenState, PenAction> | null {
    if (state.type === "anchored") {
      return this.transitionAnchored(state, event, editor);
    }
    if (state.type === "dragging") {
      return this.transitionDragging(state, event, editor);
    }
    return null;
  }

  onTransition(prev: PenState, next: PenState, _event: ToolEvent, editor: ToolContext): void {
    if ((prev.type === "anchored" || prev.type === "dragging") && next.type === "ready") {
      if (editor.commands.isBatching) {
        editor.commands.endBatch();
      }
      this.clearSnap();
      editor.setSnapIndicator(null);
    }
  }

  private transitionAnchored(
    state: PenState & { type: "anchored" },
    event: ToolEvent,
    editor: ToolContext,
  ): TransitionResult<PenState, PenAction> | null {
    if (event.type === "drag") {
      const dist = Vec2.dist(state.anchor.position, event.point);

      if (dist > DRAG_THRESHOLD) {
        this.startSnap(editor, state.anchor);

        let snappedPos: Point2D = event.point;

        if (this.#snap) {
          const result = this.#snap.snap(event.point, { shiftKey: event.shiftKey });
          snappedPos = result.point;
          editor.setSnapIndicator(result.indicator);
        }

        const handles = this.createHandles(state.anchor, snappedPos, editor);
        return {
          state: {
            type: "dragging",
            anchor: state.anchor,
            handles,
            mousePos: event.point,
            snappedPos: event.shiftKey ? snappedPos : undefined,
          },
        };
      }
      return { state };
    }

    if (event.type === "dragEnd") {
      return {
        state: {
          type: "ready",
          mousePos: event.point,
        },
      };
    }

    if (event.type === "dragCancel") {
      return {
        state: {
          type: "ready",
          mousePos: state.anchor.position,
        },
      };
    }

    if (event.type === "keyDown" && event.key === "Escape") {
      if (editor.commands.isBatching) {
        editor.commands.cancelBatch();
      }
      return {
        state: {
          type: "ready",
          mousePos: state.anchor.position,
        },
      };
    }

    return null;
  }

  private transitionDragging(
    state: PenState & { type: "dragging" },
    event: ToolEvent,
    editor: ToolContext,
  ): TransitionResult<PenState, PenAction> | null {
    if (event.type === "drag") {
      let snappedPos: Point2D = event.point;

      if (this.#snap) {
        const result = this.#snap.snap(event.point, { shiftKey: event.shiftKey });
        snappedPos = result.point;
        editor.setSnapIndicator(result.indicator);
      }

      this.updateHandles(state.anchor, state.handles, snappedPos, editor);
      return {
        state: {
          ...state,
          mousePos: event.point,
          snappedPos: event.shiftKey ? snappedPos : undefined,
        },
      };
    }

    if (event.type === "dragEnd") {
      return {
        state: {
          type: "ready",
          mousePos: event.point,
        },
      };
    }

    if (event.type === "dragCancel") {
      if (editor.commands.isBatching) {
        editor.commands.cancelBatch();
      }
      return {
        state: {
          type: "ready",
          mousePos: state.anchor.position,
        },
      };
    }

    if (event.type === "keyDown" && event.key === "Escape") {
      if (editor.commands.isBatching) {
        editor.commands.cancelBatch();
      }
      return {
        state: {
          type: "ready",
          mousePos: state.anchor.position,
        },
      };
    }

    return null;
  }

  private startSnap(editor: ToolContext, anchor: AnchorData): void {
    this.clearSnap();

    this.#snap = editor.createDragSnapSession({
      anchorPointId: anchor.pointId,
      dragStart: anchor.position,
      excludedPointIds: [],
    });
  }

  private clearSnap(): void {
    if (this.#snap) this.#snap.clear();
    this.#snap = null;
  }

  private createHandles(anchor: AnchorData, snappedPos: Point2D, editor: ToolContext): HandleData {
    const { context, pointId, position } = anchor;
    const history = editor.commands;

    if (context.isFirstPoint) {
      const cmd = new AddPointCommand(snappedPos.x, snappedPos.y, "offCurve", false);
      const cpOutId = history.execute(cmd);
      return { cpOut: cpOutId };
    }

    if (context.previousPointType === "onCurve") {
      if (context.previousOnCurvePosition) {
        const cp1Pos = Vec2.lerp(context.previousOnCurvePosition, position, 1 / 3);
        const cmd = new InsertPointCommand(pointId, cp1Pos.x, cp1Pos.y, "offCurve", false);
        history.execute(cmd);
      }

      const cpInPos = Vec2.mirror(snappedPos, position);
      const cmd = new InsertPointCommand(pointId, cpInPos.x, cpInPos.y, "offCurve", false);
      const cpInId = history.execute(cmd);

      return { cpIn: cpInId };
    }

    if (context.previousPointType === "offCurve") {
      const cpInPos = Vec2.mirror(snappedPos, position);
      const insertCmd = new InsertPointCommand(pointId, cpInPos.x, cpInPos.y, "offCurve", false);
      const cpInId = history.execute(insertCmd);

      const addCmd = new AddPointCommand(snappedPos.x, snappedPos.y, "offCurve", false);
      const cpOutId = history.execute(addCmd);

      return { cpIn: cpInId, cpOut: cpOutId };
    }

    return {};
  }

  private updateHandles(
    anchor: AnchorData,
    handles: HandleData,
    snappedPos: Point2D,
    editor: ToolContext,
  ): void {
    if (handles.cpOut) {
      editor.movePointTo(handles.cpOut, snappedPos.x, snappedPos.y);
    }

    if (handles.cpIn) {
      const mirroredPos = Vec2.mirror(snappedPos, anchor.position);
      editor.movePointTo(handles.cpIn, mirroredPos.x, mirroredPos.y);
    }
  }
}
