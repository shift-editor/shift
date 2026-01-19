import type { Editor } from "@/lib/editor/Editor";
import type { Point2D } from "@/types/math";
import type { PointId } from "@/types/ids";
import type { AnchorData, HandleData } from "./states";
import { AddPointCommand } from "@/lib/commands/PointCommands";
import {
  InsertPointCommand,
  CloseContourCommand,
  AddContourCommand,
} from "@/lib/commands/BezierCommands";
import { Vec2 } from "@/lib/geo";

export interface PlaceAnchorResult {
  pointId: PointId;
}

export interface CreateHandlesResult {
  handles: HandleData;
}

export class PenCommands {
  #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  placeAnchor(pos: Point2D): PlaceAnchorResult {
    const ctx = this.#editor.createToolContext();
    const cmd = new AddPointCommand(pos.x, pos.y, "onCurve", false);
    const pointId = ctx.commands.execute(cmd);
    return { pointId };
  }

  createHandles(anchor: AnchorData, mousePos: Point2D): CreateHandlesResult {
    const { context, pointId, position } = anchor;
    const ctx = this.#editor.createToolContext();
    const history = ctx.commands;

    if (context.isFirstPoint) {
      const cmd = new AddPointCommand(
        mousePos.x,
        mousePos.y,
        "offCurve",
        false,
      );
      const cpOutId = history.execute(cmd);
      return {
        handles: { cpOut: cpOutId },
      };
    }

    if (context.previousPointType === "onCurve") {
      if (context.previousOnCurvePosition) {
        const cp1Pos = Vec2.lerp(
          context.previousOnCurvePosition,
          position,
          1 / 3,
        );
        const cmd = new InsertPointCommand(
          pointId,
          cp1Pos.x,
          cp1Pos.y,
          "offCurve",
          false,
        );
        history.execute(cmd);
      }

      const cpInPos = Vec2.mirror(mousePos, position);
      const cmd = new InsertPointCommand(
        pointId,
        cpInPos.x,
        cpInPos.y,
        "offCurve",
        false,
      );
      const cpInId = history.execute(cmd);

      return {
        handles: { cpIn: cpInId },
      };
    }

    if (context.previousPointType === "offCurve") {
      const cpInPos = Vec2.mirror(mousePos, position);
      const insertCmd = new InsertPointCommand(
        pointId,
        cpInPos.x,
        cpInPos.y,
        "offCurve",
        false,
      );
      const cpInId = history.execute(insertCmd);

      const addCmd = new AddPointCommand(
        mousePos.x,
        mousePos.y,
        "offCurve",
        false,
      );
      const cpOutId = history.execute(addCmd);

      return {
        handles: { cpIn: cpInId, cpOut: cpOutId },
      };
    }

    return { handles: {} };
  }

  updateHandles(
    anchor: AnchorData,
    handles: HandleData,
    mousePos: Point2D,
  ): void {
    const { position } = anchor;
    const ctx = this.#editor.createToolContext();

    if (handles.cpOut) {
      ctx.edit.movePointTo(handles.cpOut, mousePos.x, mousePos.y);
    }

    if (handles.cpIn) {
      const mirroredPos = Vec2.mirror(mousePos, position);
      ctx.edit.movePointTo(handles.cpIn, mirroredPos.x, mirroredPos.y);
    }
  }

  closeContour(): void {
    const ctx = this.#editor.createToolContext();
    const history = ctx.commands;

    history.execute(new CloseContourCommand());
    history.execute(new AddContourCommand());
  }
}
