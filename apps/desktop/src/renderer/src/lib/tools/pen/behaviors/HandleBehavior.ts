import type { Point2D } from "@shift/types";
import { Vec2 } from "@shift/geo";
import type { ToolEvent } from "../../core/GestureDetector";
import type { Editor } from "@/lib/editor";
import type { PenState, PenBehavior, AnchorData, HandleData } from "../types";
import { AddPointCommand, InsertPointCommand } from "@/lib/commands";

const DRAG_THRESHOLD = 3;

export class HandleBehavior implements PenBehavior {
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

  transition(state: PenState, event: ToolEvent, editor: Editor): PenState | null {
    if (state.type === "anchored") {
      return this.transitionAnchored(state, event, editor);
    }
    if (state.type === "dragging") {
      return this.transitionDragging(state, event, editor);
    }
    return null;
  }

  onTransition(prev: PenState, next: PenState, _event: ToolEvent, editor: Editor): void {
    if ((prev.type === "anchored" || prev.type === "dragging") && next.type === "ready") {
      if (editor.commands.isBatching) {
        editor.commands.endBatch();
      }
    }
  }

  private transitionAnchored(
    state: PenState & { type: "anchored" },
    event: ToolEvent,
    editor: Editor,
  ): PenState | null {
    if (event.type === "drag") {
      const dist = Vec2.dist(state.anchor.position, event.point);

      if (dist > DRAG_THRESHOLD) {
        const handles = this.createHandles(state.anchor, event.point, editor);
        return {
          type: "dragging",
          anchor: state.anchor,
          handles,
          mousePos: event.point,
        };
      }
      return state;
    }

    if (event.type === "dragEnd") {
      return {
        type: "ready",
        mousePos: event.point,
      };
    }

    if (event.type === "dragCancel") {
      return {
        type: "ready",
        mousePos: state.anchor.position,
      };
    }

    if (event.type === "keyDown" && event.key === "Escape") {
      if (editor.commands.isBatching) {
        editor.commands.cancelBatch();
      }
      return {
        type: "ready",
        mousePos: state.anchor.position,
      };
    }

    return null;
  }

  private transitionDragging(
    state: PenState & { type: "dragging" },
    event: ToolEvent,
    editor: Editor,
  ): PenState | null {
    if (event.type === "drag") {
      this.updateHandles(state.anchor, state.handles, event.point, editor);
      return {
        ...state,
        mousePos: event.point,
      };
    }

    if (event.type === "dragEnd") {
      return {
        type: "ready",
        mousePos: event.point,
      };
    }

    if (event.type === "dragCancel") {
      if (editor.commands.isBatching) {
        editor.commands.cancelBatch();
      }
      return {
        type: "ready",
        mousePos: state.anchor.position,
      };
    }

    if (event.type === "keyDown" && event.key === "Escape") {
      if (editor.commands.isBatching) {
        editor.commands.cancelBatch();
      }
      return {
        type: "ready",
        mousePos: state.anchor.position,
      };
    }

    return null;
  }

  private createHandles(anchor: AnchorData, mousePos: Point2D, editor: Editor): HandleData {
    const { context, pointId, position } = anchor;
    const history = editor.commands;

    if (context.isFirstPoint) {
      const cmd = new AddPointCommand(mousePos.x, mousePos.y, "offCurve", false);
      const cpOutId = history.execute(cmd);
      return { cpOut: cpOutId };
    }

    if (context.previousPointType === "onCurve") {
      if (context.previousOnCurvePosition) {
        const cp1Pos = Vec2.lerp(context.previousOnCurvePosition, position, 1 / 3);
        const cmd = new InsertPointCommand(pointId, cp1Pos.x, cp1Pos.y, "offCurve", false);
        history.execute(cmd);
      }

      const cpInPos = Vec2.mirror(mousePos, position);
      const cmd = new InsertPointCommand(pointId, cpInPos.x, cpInPos.y, "offCurve", false);
      const cpInId = history.execute(cmd);

      return { cpIn: cpInId };
    }

    if (context.previousPointType === "offCurve") {
      const cpInPos = Vec2.mirror(mousePos, position);
      const insertCmd = new InsertPointCommand(pointId, cpInPos.x, cpInPos.y, "offCurve", false);
      const cpInId = history.execute(insertCmd);

      const addCmd = new AddPointCommand(mousePos.x, mousePos.y, "offCurve", false);
      const cpOutId = history.execute(addCmd);

      return { cpIn: cpInId, cpOut: cpOutId };
    }

    return {};
  }

  private updateHandles(
    anchor: AnchorData,
    handles: HandleData,
    mousePos: Point2D,
    editor: Editor,
  ): void {
    const { position } = anchor;

    if (handles.cpOut) {
      editor.edit.movePointTo(handles.cpOut, mousePos.x, mousePos.y);
    }

    if (handles.cpIn) {
      const mirroredPos = Vec2.mirror(mousePos, position);
      editor.edit.movePointTo(handles.cpIn, mirroredPos.x, mirroredPos.y);
    }
  }
}
