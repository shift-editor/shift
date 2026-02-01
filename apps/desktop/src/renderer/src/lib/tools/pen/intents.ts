import type { Point2D, ContourId, PointId } from "@shift/types";
import type { ToolContext } from "@/lib/tools/core";
import type { Segment } from "@/types/segments";
import type { HitResult } from "@/types/hitResult";
import { isContourEndpointHit, isMiddlePointHit, isSegmentHit } from "@/types/hitResult";
import {
  AddPointCommand,
  CloseContourCommand,
  AddContourCommand,
  SetActiveContourCommand,
  ReverseContourCommand,
  SplitSegmentCommand,
} from "@/lib/commands";

export type PenIntent =
  | { action: "close" }
  | {
      action: "continue";
      contourId: ContourId;
      pointId: PointId;
      fromStart: boolean;
    }
  | {
      action: "splitPoint";
      contourId: ContourId;
      pointId: PointId;
      pointIndex: number;
    }
  | { action: "splitSegment"; segment: Segment; t: number }
  | { action: "placePoint"; pos: Point2D }
  | { action: "abandonContour" }
  | { action: "updateHover"; pos: Point2D };

export interface PenIntentContext {
  getNodeAt(pos: Point2D): HitResult;
  getActiveContourId(): ContourId | null;
  hasActiveDrawingContour(): boolean;
  shouldCloseContour(pos: Point2D): boolean;
}

export function resolvePenIntent(pos: Point2D, ctx: PenIntentContext): PenIntent {
  if (ctx.shouldCloseContour(pos)) {
    return { action: "close" };
  }

  if (!ctx.hasActiveDrawingContour()) {
    const hit = ctx.getNodeAt(pos);

    if (isContourEndpointHit(hit) && !hit.contour.closed) {
      return {
        action: "continue",
        contourId: hit.contourId,
        pointId: hit.pointId,
        fromStart: hit.position === "start",
      };
    }

    if (isMiddlePointHit(hit)) {
      return {
        action: "splitPoint",
        contourId: hit.contourId,
        pointId: hit.pointId,
        pointIndex: hit.pointIndex,
      };
    }

    if (isSegmentHit(hit)) {
      return {
        action: "splitSegment",
        segment: hit.segment,
        t: hit.t,
      };
    }
  }

  return { action: "placePoint", pos };
}

export function executeIntent(intent: PenIntent, editor: ToolContext): PointId | null {
  switch (intent.action) {
    case "close":
      editor.commands.execute(new CloseContourCommand());
      editor.commands.execute(new AddContourCommand());
      return null;

    case "continue":
      editor.commands.execute(new SetActiveContourCommand(intent.contourId));
      if (intent.fromStart) {
        editor.commands.execute(new ReverseContourCommand(intent.contourId));
      }

      editor.selectPoints([intent.pointId]);
      return null;

    case "splitPoint":
      editor.setActiveContour(intent.contourId);
      return null;

    case "splitSegment": {
      const cmd = new SplitSegmentCommand(intent.segment as any, intent.t);
      return editor.commands.execute(cmd);
    }

    case "placePoint": {
      const cmd = new AddPointCommand(intent.pos.x, intent.pos.y, "onCurve", false);
      return editor.commands.execute(cmd);
    }

    case "abandonContour":
      editor.clearSelection();
      editor.commands.execute(new AddContourCommand());
      return null;

    case "updateHover":
      editor.updateHover(intent.pos);
      return null;
  }
}
