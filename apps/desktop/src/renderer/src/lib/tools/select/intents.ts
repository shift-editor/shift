import type { PointId, Point2D, Rect2D, ContourId } from "@shift/types";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import type { SelectionMode } from "@/types/editor";
import type { Editor } from "@/lib/editor";
import {
  NudgePointsCommand,
  ScalePointsCommand,
  RotatePointsCommand,
  UpgradeLineToCubicCommand,
  ScaleHandlesCommand,
} from "@/lib/commands";
import { asPointId } from "@shift/types";
import { Segment as SegmentOps } from "@/lib/geo/Segment";
import { pointInRect } from "./utils";
import type { LineSegment } from "@/types/segments";

export type SelectIntent =
  | { action: "selectPoint"; pointId: PointId; additive: boolean }
  | { action: "selectSegment"; segmentId: SegmentId; additive: boolean }
  | { action: "togglePoint"; pointId: PointId }
  | { action: "toggleSegment"; segmentId: SegmentId }
  | { action: "selectPointsInRect"; rect: Rect2D }
  | { action: "clearSelection" }
  | { action: "clearAndStartMarquee" }
  | { action: "setSelectionMode"; mode: SelectionMode }
  | { action: "setHoveredPoint"; pointId: PointId }
  | { action: "setHoveredSegment"; indicator: SegmentIndicator }
  | { action: "clearHover" }
  | { action: "beginPreview" }
  | { action: "commitPreview"; label: string }
  | { action: "cancelPreview" }
  | { action: "movePointsDelta"; delta: Point2D }
  | {
      action: "scalePoints";
      pointIds: PointId[];
      sx: number;
      sy: number;
      anchor: Point2D;
    }
  | {
      action: "rotatePoints";
      pointIds: PointId[];
      angle: number;
      center: Point2D;
    }
  | { action: "nudge"; dx: number; dy: number; pointIds: PointId[] }
  | { action: "scaleHandles"; pointIds: PointId[]; scaleDelta: number }
  | { action: "toggleSmooth"; pointId: PointId }
  | { action: "selectPoints"; pointIds: PointId[] }
  | { action: "upgradeLineToCubic"; segment: LineSegment }
  | { action: "selectContour"; contourId: ContourId; additive: boolean };

export function executeIntent(intent: SelectIntent, editor: Editor): void {
  switch (intent.action) {
    case "selectPoint":
      executeSelectPoint(intent.pointId, intent.additive, editor);
      break;

    case "selectSegment":
      executeSelectSegment(intent.segmentId, intent.additive, editor);
      break;

    case "togglePoint":
      editor.selection.togglePoint(intent.pointId);
      break;

    case "toggleSegment":
      executeToggleSegment(intent.segmentId, editor);
      break;

    case "selectPointsInRect":
      executeSelectPointsInRect(intent.rect, editor);
      break;

    case "clearSelection":
      editor.selection.clear();
      break;

    case "clearAndStartMarquee":
      editor.selection.clear();
      editor.selection.setMode("preview");
      break;

    case "setSelectionMode":
      editor.selection.setMode(intent.mode);
      break;

    case "setHoveredPoint":
      editor.hover.setHoveredPoint(intent.pointId);
      break;

    case "setHoveredSegment":
      editor.hover.setHoveredSegment(intent.indicator);
      break;

    case "clearHover":
      editor.hover.clearAll();
      break;

    case "beginPreview":
      editor.preview.beginPreview();
      break;

    case "commitPreview":
      editor.preview.commitPreview(intent.label);
      break;

    case "cancelPreview":
      editor.preview.cancelPreview();
      break;

    case "movePointsDelta":
      executeMovePointsDelta(intent.delta, editor);
      break;

    case "scalePoints":
      executeScalePoints(intent.pointIds, intent.sx, intent.sy, intent.anchor, editor);
      break;

    case "rotatePoints":
      executeRotatePoints(intent.pointIds, intent.angle, intent.center, editor);
      break;

    case "nudge":
      executeNudge(intent.pointIds, intent.dx, intent.dy, editor);
      break;

    case "scaleHandles":
      executeScaleHandles(intent.pointIds, intent.scaleDelta, editor);
      break;

    case "toggleSmooth":
      editor.edit.toggleSmooth(intent.pointId);
      editor.render.requestRedraw();
      break;

    case "selectPoints":
      editor.selection.clear();
      editor.selection.selectPoints(intent.pointIds);
      break;

    case "upgradeLineToCubic":
      executeUpgradeLineToCubic(intent.segment, editor);
      break;

    case "selectContour":
      executeSelectContour(intent.contourId, intent.additive, editor);
      break;
  }
}

function executeSelectPoint(pointId: PointId, additive: boolean, editor: Editor): void {
  if (additive) {
    const current = editor.selection.getSelectedPoints();
    editor.selection.selectPoints([...current, pointId]);
  } else {
    editor.selection.clear();
    editor.selection.selectPoints([pointId]);
  }
}

function executeSelectSegment(segmentId: SegmentId, additive: boolean, editor: Editor): PointId[] {
  const segment = editor.hitTest.getSegmentById(segmentId);
  if (!segment) return [];

  const pointIds = SegmentOps.getPointIds(segment);

  if (additive) {
    editor.selection.addSegment(segmentId);
    for (const id of pointIds) {
      editor.selection.addPoint(id);
    }
  } else {
    editor.selection.selectSegments([segmentId]);
    editor.selection.selectPoints(pointIds);
  }

  return pointIds;
}

function executeToggleSegment(segmentId: SegmentId, editor: Editor): PointId[] {
  const wasSelected = editor.selection.isSegmentSelected(segmentId);
  editor.selection.toggleSegment(segmentId);

  const segment = editor.hitTest.getSegmentById(segmentId);
  if (!segment) return [];

  const pointIds = SegmentOps.getPointIds(segment);

  if (wasSelected) {
    for (const id of pointIds) {
      editor.selection.removePoint(id);
    }
    return [];
  } else {
    for (const id of pointIds) {
      editor.selection.addPoint(id);
    }
    return pointIds;
  }
}

function executeSelectPointsInRect(rect: Rect2D, editor: Editor): PointId[] {
  const allPoints = editor.hitTest.getAllPoints();
  const hitPoints = allPoints.filter((p) => pointInRect(p, rect));
  const pointIds = hitPoints.map((p) => asPointId(p.id));
  editor.selection.clear();
  editor.selection.selectPoints(pointIds);
  return pointIds;
}

function executeMovePointsDelta(delta: Point2D, editor: Editor): void {
  if (delta.x === 0 && delta.y === 0) return;
  const selectedPoints = editor.selection.getSelectedPoints();
  editor.edit.applySmartEdits(selectedPoints, delta.x, delta.y);
}

function executeScalePoints(
  pointIds: PointId[],
  sx: number,
  sy: number,
  anchor: Point2D,
  editor: Editor,
): void {
  editor.preview.cancelPreview();
  if (sx !== 1 || sy !== 1) {
    const cmd = new ScalePointsCommand(pointIds, sx, sy, anchor);
    editor.commands.execute(cmd);
  }
}

function executeRotatePoints(
  pointIds: PointId[],
  angle: number,
  center: Point2D,
  editor: Editor,
): void {
  editor.preview.cancelPreview();
  if (angle !== 0) {
    const cmd = new RotatePointsCommand(pointIds, angle, center);
    editor.commands.execute(cmd);
  }
}

function executeNudge(pointIds: PointId[], dx: number, dy: number, editor: Editor): void {
  if (pointIds.length === 0) return;
  const cmd = new NudgePointsCommand(pointIds, dx, dy);
  editor.commands.execute(cmd);
  editor.render.requestRedraw();
}

function executeScaleHandles(pointIds: PointId[], scaleDelta: number, editor: Editor): void {
  if (pointIds.length === 0) return;
  const glyph = editor.getGlyph();
  if (!glyph) return;

  const cmd = new ScaleHandlesCommand(glyph, pointIds, scaleDelta);
  editor.commands.execute(cmd);
  editor.render.requestRedraw();
}

function executeUpgradeLineToCubic(segment: LineSegment, editor: Editor): void {
  const cmd = new UpgradeLineToCubicCommand(segment);
  editor.commands.execute(cmd);
  editor.render.requestRedraw();
}

function executeSelectContour(contourId: ContourId, additive: boolean, editor: Editor): void {
  const glyph = editor.getGlyph();
  if (!glyph) return;

  const contour = glyph.contours.find((c) => c.id === contourId);
  if (!contour) return;

  const pointIds = contour.points.map((p) => asPointId(p.id));

  if (!additive) {
    editor.selection.clear();
  }
  editor.selection.selectPoints(pointIds);
}
