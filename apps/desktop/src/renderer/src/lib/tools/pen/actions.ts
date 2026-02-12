import type { Point2D, ContourId, PointId } from "@shift/types";
import type { EditorAPI } from "@/lib/tools/core";
import type { Segment } from "@/types/segments";
import type { HitResult } from "@/types/hitResult";
import type { Coordinates } from "@/types/coordinates";
import { isContourEndpointHit, isMiddlePointHit, isSegmentHit } from "@/types/hitResult";
import {
  AddPointCommand,
  CloseContourCommand,
  AddContourCommand,
  SetActiveContourCommand,
  ReverseContourCommand,
  SplitSegmentCommand,
} from "@/lib/commands";

export type PenAction =
  | { type: "close" }
  | {
      type: "continue";
      contourId: ContourId;
      pointId: PointId;
      fromStart: boolean;
    }
  | {
      type: "splitPoint";
      contourId: ContourId;
      pointId: PointId;
      pointIndex: number;
    }
  | { type: "splitSegment"; segment: Segment; t: number }
  | { type: "placePoint"; pos: Point2D }
  | { type: "abandonContour" }
  | { type: "updateHover"; pos: Point2D };

export interface PenActionContext {
  getNodeAt(coords: Coordinates): HitResult;
  getActiveContourId(): ContourId | null;
  hasActiveDrawingContour(): boolean;
  shouldCloseContour(coords: Coordinates): boolean;
}

export function resolvePenAction(coords: Coordinates, ctx: PenActionContext): PenAction {
  if (ctx.shouldCloseContour(coords)) {
    return { type: "close" };
  }

  if (!ctx.hasActiveDrawingContour()) {
    const hit = ctx.getNodeAt(coords);

    if (isContourEndpointHit(hit) && !hit.contour.closed) {
      const { contourId, pointId, position } = hit;
      return {
        type: "continue",
        contourId,
        pointId,
        fromStart: position === "start",
      };
    }

    if (isMiddlePointHit(hit)) {
      const { contourId, pointId, pointIndex } = hit;
      return {
        type: "splitPoint",
        contourId,
        pointId,
        pointIndex,
      };
    }

    if (isSegmentHit(hit)) {
      const { segment, t } = hit;
      return {
        type: "splitSegment",
        segment,
        t,
      };
    }
  }

  return { type: "placePoint", pos: coords.glyphLocal };
}

export function executeAction(action: PenAction, editor: EditorAPI): PointId | null {
  switch (action.type) {
    case "close":
      editor.commands.execute(new CloseContourCommand());
      editor.commands.execute(new AddContourCommand());
      return null;

    case "continue":
      editor.commands.execute(new SetActiveContourCommand(action.contourId));
      if (action.fromStart) {
        editor.commands.execute(new ReverseContourCommand(action.contourId));
      }

      editor.selectPoints([action.pointId]);
      return null;

    case "splitPoint":
      editor.setActiveContour(action.contourId);
      return null;

    case "splitSegment": {
      const cmd = new SplitSegmentCommand(action.segment as any, action.t);
      return editor.commands.execute(cmd);
    }

    case "placePoint": {
      const cmd = new AddPointCommand(action.pos.x, action.pos.y, "onCurve", false);
      return editor.commands.execute(cmd);
    }

    case "abandonContour":
      editor.clearSelection();
      editor.commands.execute(new AddContourCommand());
      return null;

    case "updateHover":
      editor.updateHover(editor.fromGlyphLocal(action.pos.x, action.pos.y));
      return null;
  }
}
