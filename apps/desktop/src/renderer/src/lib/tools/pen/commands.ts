import type { Editor } from "@/lib/editor/Editor";
import type { Point2D, PointId, ContourId } from "@shift/types";
import type {
  AnchorData,
  HandleData,
  PlaceAnchorResult,
  CreateHandlesResult,
} from "@/types/pen";
import {
  AddPointCommand,
  InsertPointCommand,
  CloseContourCommand,
  AddContourCommand,
  SetActiveContourCommand,
  ReverseContourCommand,
  SplitSegmentCommand,
} from "@/lib/commands";
import { Vec2 } from "@shift/geo";
import type { Segment } from "@/types/segments";

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

  abandonContour(): void {
    const ctx = this.#editor.createToolContext();
    const snapshot = ctx.glyph;
    if (!snapshot) return;

    const activeContourId = ctx.edit.getActiveContourId();
    const activeContour = snapshot.contours.find(
      (c) => c.id === activeContourId,
    );

    if (
      !activeContour ||
      activeContour.points.length === 0 ||
      activeContour.closed
    ) {
      return;
    }

    ctx.commands.execute(new AddContourCommand());
  }

  continueContour(contourId: ContourId, fromStart: boolean): void {
    const ctx = this.#editor.createToolContext();
    const history = ctx.commands;

    history.execute(new SetActiveContourCommand(contourId));

    if (fromStart) {
      history.execute(new ReverseContourCommand(contourId));
    }
  }

  splitContour(contourId: ContourId, atPointIndex: number): void {
    const ctx = this.#editor.createToolContext();
    const snapshot = ctx.glyph;
    if (!snapshot) return;

    const contour = snapshot.contours.find((c) => c.id === contourId);
    if (!contour) return;

    if (atPointIndex <= 0 || atPointIndex >= contour.points.length - 1) {
      return;
    }

    const pointsAfterSplit = contour.points.slice(atPointIndex);

    const history = ctx.commands;
    history.execute(new AddContourCommand());

    const newContourId = ctx.edit.getActiveContourId();
    if (!newContourId) return;

    for (const point of pointsAfterSplit) {
      ctx.edit.addPointToContour(
        newContourId,
        point.x,
        point.y,
        point.pointType,
        point.smooth,
      );
    }

    const pointIdsToRemove = pointsAfterSplit
      .slice(1)
      .map((p) => p.id as PointId);
    if (pointIdsToRemove.length > 0) {
      ctx.edit.removePoints(pointIdsToRemove);
    }
  }

  /**
   * Split a curve segment at the given parameter t.
   * Inserts a new on-curve point and adjusts control points accordingly.
   *
   * @param segment - The segment to split
   * @param t - The parameter value (0-1) where to split
   * @returns The ID of the new on-curve point, or null if split failed
   */
  splitSegment(segment: Segment, t: number): PointId | null {
    const ctx = this.#editor.createToolContext();
    const cmd = new SplitSegmentCommand(segment, t);
    return ctx.commands.execute(cmd);
  }
}
