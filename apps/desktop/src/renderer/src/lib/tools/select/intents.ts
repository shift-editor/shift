import type { PointId, Point2D, Rect2D } from "@shift/types";
import type { SegmentId, SegmentIndicator } from "@/types/indicator";
import type { SelectionMode } from "@/types/editor";
import type { ToolContext } from "../core/createContext";
import { NudgePointsCommand, ScalePointsCommand, RotatePointsCommand } from "@/lib/commands";
import { asPointId } from "@shift/types";
import { Segment as SegmentOps } from "@/lib/geo/Segment";
import { pointInRect } from "./utils";

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
  | { action: "toggleSmooth"; pointId: PointId };

export function executeIntent(intent: SelectIntent, ctx: ToolContext): void {
  switch (intent.action) {
    case "selectPoint":
      executeSelectPoint(intent.pointId, intent.additive, ctx);
      break;

    case "selectSegment":
      executeSelectSegment(intent.segmentId, intent.additive, ctx);
      break;

    case "togglePoint":
      ctx.selection.togglePoint(intent.pointId);
      break;

    case "toggleSegment":
      executeToggleSegment(intent.segmentId, ctx);
      break;

    case "selectPointsInRect":
      executeSelectPointsInRect(intent.rect, ctx);
      break;

    case "clearSelection":
      ctx.selection.clear();
      break;

    case "clearAndStartMarquee":
      ctx.selection.clear();
      ctx.selection.setMode("preview");
      break;

    case "setSelectionMode":
      ctx.selection.setMode(intent.mode);
      break;

    case "setHoveredPoint":
      ctx.hover.setHoveredPoint(intent.pointId);
      break;

    case "setHoveredSegment":
      ctx.hover.setHoveredSegment(intent.indicator);
      break;

    case "clearHover":
      ctx.hover.clearAll();
      break;

    case "beginPreview":
      ctx.preview.beginPreview();
      break;

    case "commitPreview":
      ctx.preview.commitPreview(intent.label);
      break;

    case "cancelPreview":
      ctx.preview.cancelPreview();
      break;

    case "movePointsDelta":
      executeMovePointsDelta(intent.delta, ctx);
      break;

    case "scalePoints":
      executeScalePoints(intent.pointIds, intent.sx, intent.sy, intent.anchor, ctx);
      break;

    case "rotatePoints":
      executeRotatePoints(intent.pointIds, intent.angle, intent.center, ctx);
      break;

    case "nudge":
      executeNudge(intent.pointIds, intent.dx, intent.dy, ctx);
      break;

    case "toggleSmooth":
      ctx.edit.toggleSmooth(intent.pointId);
      ctx.render.requestRedraw();
      break;
  }
}

function executeSelectPoint(pointId: PointId, additive: boolean, ctx: ToolContext): void {
  if (additive) {
    const current = ctx.selection.getSelectedPoints();
    const newSelection = new Set(current);
    newSelection.add(pointId);
    ctx.selection.selectPoints(newSelection);
  } else {
    ctx.selection.clear();
    ctx.selection.selectPoints(new Set([pointId]));
  }
}

function executeSelectSegment(
  segmentId: SegmentId,
  additive: boolean,
  ctx: ToolContext,
): PointId[] {
  const segment = ctx.hitTest.findSegmentById(segmentId);
  if (!segment) return [];

  const pointIds = SegmentOps.getPointIds(segment);

  if (additive) {
    ctx.selection.addSegment(segmentId);
    for (const id of pointIds) {
      ctx.selection.addPoint(id);
    }
  } else {
    ctx.selection.selectSegments(new Set([segmentId]));
    ctx.selection.selectPoints(new Set(pointIds));
  }

  return pointIds;
}

function executeToggleSegment(segmentId: SegmentId, ctx: ToolContext): PointId[] {
  const wasSelected = ctx.selection.isSegmentSelected(segmentId);
  ctx.selection.toggleSegment(segmentId);

  const segment = ctx.hitTest.findSegmentById(segmentId);
  if (!segment) return [];

  const pointIds = SegmentOps.getPointIds(segment);

  if (wasSelected) {
    for (const id of pointIds) {
      ctx.selection.removePoint(id);
    }
    return [];
  } else {
    for (const id of pointIds) {
      ctx.selection.addPoint(id);
    }
    return pointIds;
  }
}

function executeSelectPointsInRect(rect: Rect2D, ctx: ToolContext): Set<PointId> {
  const allPoints = ctx.hitTest.getAllPoints();
  const hitPoints = allPoints.filter((p) => pointInRect(p, rect));
  const pointIds = new Set(hitPoints.map((p) => asPointId(p.id)));
  ctx.selection.clear();
  ctx.selection.selectPoints(pointIds);
  return pointIds;
}

function executeMovePointsDelta(delta: Point2D, ctx: ToolContext): void {
  if (delta.x !== 0 || delta.y !== 0) {
    const selectedPoints = ctx.selection.getSelectedPoints();
    ctx.edit.applySmartEdits(selectedPoints, delta.x, delta.y);
  }
}

function executeScalePoints(
  pointIds: PointId[],
  sx: number,
  sy: number,
  anchor: Point2D,
  ctx: ToolContext,
): void {
  ctx.preview.cancelPreview();
  if (sx !== 1 || sy !== 1) {
    const cmd = new ScalePointsCommand(pointIds, sx, sy, anchor);
    ctx.commands.execute(cmd);
  }
}

function executeRotatePoints(
  pointIds: PointId[],
  angle: number,
  center: Point2D,
  ctx: ToolContext,
): void {
  ctx.preview.cancelPreview();
  if (angle !== 0) {
    const cmd = new RotatePointsCommand(pointIds, angle, center);
    ctx.commands.execute(cmd);
  }
}

function executeNudge(pointIds: PointId[], dx: number, dy: number, ctx: ToolContext): void {
  if (pointIds.length === 0) return;
  const cmd = new NudgePointsCommand(pointIds, dx, dy);
  ctx.commands.execute(cmd);
  ctx.render.requestRedraw();
}
