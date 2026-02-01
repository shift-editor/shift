import type { Point2D, ContourId, PointId } from "@shift/types";
import type { Editor, HitTestService } from "@/lib/editor";
import type { Segment } from "@/types/segments";
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
  hitTest: HitTestService;
  getActiveContourId(): ContourId | null;
  hasActiveDrawingContour(): boolean;
  shouldCloseContour(pos: Point2D): boolean;
  getMiddlePointAt?(
    pos: Point2D,
  ): { contourId: ContourId; pointId: PointId; pointIndex: number } | null;
}

export function resolvePenIntent(pos: Point2D, ctx: PenIntentContext): PenIntent {
  if (ctx.shouldCloseContour(pos)) {
    return { action: "close" };
  }

  if (!ctx.hasActiveDrawingContour()) {
    const endpoint = ctx.hitTest.getContourEndpointAt(pos);
    if (endpoint && !endpoint.contour.closed) {
      return {
        action: "continue",
        contourId: endpoint.contourId,
        pointId: endpoint.pointId,
        fromStart: endpoint.position === "start",
      };
    }

    if (ctx.getMiddlePointAt) {
      const middlePoint = ctx.getMiddlePointAt(pos);
      if (middlePoint) {
        return {
          action: "splitPoint",
          contourId: middlePoint.contourId,
          pointId: middlePoint.pointId,
          pointIndex: middlePoint.pointIndex,
        };
      }
    }

    const segmentHit = ctx.hitTest.getSegmentAt(pos);
    if (segmentHit) {
      return {
        action: "splitSegment",
        segment: segmentHit.segment,
        t: segmentHit.t,
      };
    }
  }

  return { action: "placePoint", pos };
}

export function executeIntent(intent: PenIntent, editor: Editor): PointId | null {
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

      editor.selection.selectPoints([intent.pointId]);
      return null;

    case "splitPoint":
      editor.edit.setActiveContour(intent.contourId);
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
      editor.selection.clear();
      editor.commands.execute(new AddContourCommand());
      return null;

    case "updateHover":
      editor.hitTest.updateHover(intent.pos);
      return null;
  }
}
