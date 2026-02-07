import type { PointId, Point2D, Rect2D, ContourId } from "@shift/types";
import type { SegmentId } from "@/types/indicator";
import type { SelectionMode } from "@/types/editor";
import type { ToolContext } from "@/lib/tools/core";
import {
  NudgePointsCommand,
  ScalePointsCommand,
  RotatePointsCommand,
  UpgradeLineToCubicCommand,
} from "@/lib/commands";
import { Segment as SegmentOps } from "@/lib/geo/Segment";
import { pointInRect } from "./utils";
import type { LineSegment } from "@/types/segments";

export type SelectAction =
  | { type: "selectPoint"; pointId: PointId; additive: boolean }
  | { type: "selectSegment"; segmentId: SegmentId; additive: boolean }
  | { type: "togglePoint"; pointId: PointId }
  | { type: "toggleSegment"; segmentId: SegmentId }
  | { type: "selectPointsInRect"; rect: Rect2D }
  | { type: "clearSelection" }
  | { type: "clearAndStartMarquee" }
  | { type: "setSelectionMode"; mode: SelectionMode }
  | { type: "beginPreview" }
  | { type: "commitPreview"; label: string }
  | { type: "cancelPreview" }
  | { type: "movePointsDelta"; delta: Point2D }
  | {
      type: "scalePoints";
      pointIds: PointId[];
      sx: number;
      sy: number;
      anchor: Point2D;
    }
  | {
      type: "rotatePoints";
      pointIds: PointId[];
      angle: number;
      center: Point2D;
    }
  | { type: "nudge"; dx: number; dy: number; pointIds: PointId[] }
  | { type: "toggleSmooth"; pointId: PointId }
  | { type: "selectPoints"; pointIds: PointId[] }
  | { type: "upgradeLineToCubic"; segment: LineSegment }
  | { type: "selectContour"; contourId: ContourId; additive: boolean };

export function executeAction(action: SelectAction, editor: ToolContext): void {
  switch (action.type) {
    case "selectPoint":
      executeSelectPoint(action.pointId, action.additive, editor);
      break;

    case "selectSegment":
      executeSelectSegment(action.segmentId, action.additive, editor);
      break;

    case "togglePoint":
      editor.togglePointSelection(action.pointId);
      break;

    case "toggleSegment":
      executeToggleSegment(action.segmentId, editor);
      break;

    case "selectPointsInRect":
      executeSelectPointsInRect(action.rect, editor);
      break;

    case "clearSelection":
      editor.clearSelection();
      break;

    case "clearAndStartMarquee":
      editor.clearSelection();
      editor.setSelectionMode("preview");
      break;

    case "setSelectionMode":
      editor.setSelectionMode(action.mode);
      break;

    case "beginPreview":
      editor.beginPreview();
      break;

    case "commitPreview":
      editor.commitPreview(action.label);
      break;

    case "cancelPreview":
      editor.cancelPreview();
      break;

    case "movePointsDelta":
      executeMovePointsDelta(action.delta, editor);
      break;

    case "scalePoints":
      executeScalePoints(action.pointIds, action.sx, action.sy, action.anchor, editor);
      break;

    case "rotatePoints":
      executeRotatePoints(action.pointIds, action.angle, action.center, editor);
      break;

    case "nudge":
      executeNudge(action.pointIds, action.dx, action.dy, editor);
      break;

    case "toggleSmooth":
      editor.toggleSmooth(action.pointId);
      break;

    case "selectPoints":
      editor.clearSelection();
      editor.selectPoints(action.pointIds);
      break;

    case "upgradeLineToCubic":
      executeUpgradeLineToCubic(action.segment, editor);
      break;

    case "selectContour":
      executeSelectContour(action.contourId, action.additive, editor);
      break;
  }
}

function executeSelectPoint(pointId: PointId, additive: boolean, editor: ToolContext): void {
  if (additive) {
    const current = editor.getSelectedPoints();
    editor.selectPoints([...current, pointId]);
  } else {
    editor.clearSelection();
    editor.selectPoints([pointId]);
  }
}

function executeSelectSegment(
  segmentId: SegmentId,
  additive: boolean,
  editor: ToolContext,
): PointId[] {
  const segment = editor.getSegmentById(segmentId);
  if (!segment) return [];

  const pointIds = SegmentOps.getPointIds(segment);

  if (additive) {
    editor.addSegmentToSelection(segmentId);
    for (const id of pointIds) {
      editor.addPointToSelection(id);
    }
  } else {
    editor.selectSegments([segmentId]);
    editor.selectPoints(pointIds);
  }

  return pointIds;
}

function executeToggleSegment(segmentId: SegmentId, editor: ToolContext): PointId[] {
  const wasSelected = editor.isSegmentSelected(segmentId);
  editor.toggleSegmentInSelection(segmentId);

  const segment = editor.getSegmentById(segmentId);
  if (!segment) return [];

  const pointIds = SegmentOps.getPointIds(segment);

  if (wasSelected) {
    for (const id of pointIds) {
      editor.removePointFromSelection(id);
    }
    return [];
  } else {
    for (const id of pointIds) {
      editor.addPointToSelection(id);
    }
    return pointIds;
  }
}

function executeSelectPointsInRect(rect: Rect2D, editor: ToolContext): PointId[] {
  const allPoints = editor.getAllPoints();
  const hitPoints = allPoints.filter((p) => pointInRect(p, rect));
  const pointIds = hitPoints.map((p) => p.id);
  editor.clearSelection();
  editor.selectPoints(pointIds);
  return pointIds;
}

function executeMovePointsDelta(delta: Point2D, editor: ToolContext): void {
  if (delta.x === 0 && delta.y === 0) return;
  const selectedPoints = editor.getSelectedPoints();
  editor.applySmartEdits(selectedPoints, delta.x, delta.y);
}

function executeScalePoints(
  pointIds: PointId[],
  sx: number,
  sy: number,
  anchor: Point2D,
  editor: ToolContext,
): void {
  editor.cancelPreview();
  if (sx !== 1 || sy !== 1) {
    const cmd = new ScalePointsCommand(pointIds, sx, sy, anchor);
    editor.commands.execute(cmd);
  }
}

function executeRotatePoints(
  pointIds: PointId[],
  angle: number,
  center: Point2D,
  editor: ToolContext,
): void {
  editor.cancelPreview();
  if (angle !== 0) {
    const cmd = new RotatePointsCommand(pointIds, angle, center);
    editor.commands.execute(cmd);
  }
}

function executeNudge(pointIds: PointId[], dx: number, dy: number, editor: ToolContext): void {
  if (pointIds.length === 0) return;
  const cmd = new NudgePointsCommand(pointIds, dx, dy);
  editor.commands.execute(cmd);
}

function executeUpgradeLineToCubic(segment: LineSegment, editor: ToolContext): void {
  const cmd = new UpgradeLineToCubicCommand(segment);
  editor.commands.execute(cmd);
}

function executeSelectContour(contourId: ContourId, additive: boolean, editor: ToolContext): void {
  const glyph = editor.getGlyph();
  if (!glyph) return;

  const contour = glyph.contours.find((c) => c.id === contourId);
  if (!contour) return;

  const pointIds = contour.points.map((p) => p.id);

  if (!additive) {
    editor.clearSelection();
  }
  editor.selectPoints(pointIds);
}
