import type { PointId, Point2D, Rect2D, ContourId, AnchorId } from "@shift/types";
import type { SegmentId } from "@/types/indicator";
import type { SelectionMode } from "@/types/editor";
import type { EditorAPI } from "@/lib/tools/core";
import type { NodePositionUpdate } from "@/types/positionUpdate";
import {
  NudgePointsCommand,
  ScalePointsCommand,
  RotatePointsCommand,
  UpgradeLineToCubicCommand,
} from "@/lib/commands";
import { Segment as SegmentOps } from "@/lib/geo/Segment";
import { pointInRect } from "./utils";
import type { LineSegment } from "@/types/segments";
import type { GlyphRef } from "../text/layout";
import { resolveComponentAtPoint } from "./compositeHitTest";

export type SelectAction =
  | { type: "selectPoint"; pointId: PointId; additive: boolean }
  | { type: "selectAnchor"; anchorId: AnchorId; additive: boolean }
  | { type: "selectSegment"; segmentId: SegmentId; additive: boolean }
  | { type: "togglePoint"; pointId: PointId }
  | { type: "toggleAnchor"; anchorId: AnchorId }
  | { type: "toggleSegment"; segmentId: SegmentId }
  | { type: "selectPointsInRect"; rect: Rect2D }
  | { type: "clearSelection" }
  | { type: "clearAndStartMarquee" }
  | { type: "setSelectionMode"; mode: SelectionMode }
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
  | {
      type: "moveSelectionDelta";
      delta: Point2D;
      pointIds: PointId[];
      anchorIds: AnchorId[];
    }
  | { type: "nudge"; dx: number; dy: number; pointIds: PointId[] }
  | { type: "toggleSmooth"; pointId: PointId }
  | { type: "selectPoints"; pointIds: PointId[] }
  | { type: "upgradeLineToCubic"; segment: LineSegment }
  | { type: "selectContour"; contourId: ContourId; additive: boolean }
  | { type: "editTextRunSlot"; index: number; point: Point2D }
  | { type: "clearTextRunCompositeInspection" };

export function executeAction(action: SelectAction, editor: EditorAPI): void {
  switch (action.type) {
    case "selectPoint":
      executeSelectPoint(action.pointId, action.additive, editor);
      break;

    case "selectAnchor":
      executeSelectAnchor(action.anchorId, action.additive, editor);
      break;

    case "selectSegment":
      executeSelectSegment(action.segmentId, action.additive, editor);
      break;

    case "togglePoint":
      editor.togglePointSelection(action.pointId);
      break;

    case "toggleAnchor":
      editor.toggleAnchorSelection(action.anchorId);
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

    case "scalePoints":
      executeScalePoints(action.pointIds, action.sx, action.sy, action.anchor, editor);
      break;

    case "rotatePoints":
      executeRotatePoints(action.pointIds, action.angle, action.center, editor);
      break;

    case "moveSelectionDelta":
      executeMoveSelectionDelta(action.pointIds, action.anchorIds, action.delta, editor);
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

    case "editTextRunSlot":
      executeEditTextRunSlot(action.index, action.point, editor);
      break;

    case "clearTextRunCompositeInspection":
      editor.clearTextRunInspection();
      break;
  }
}

function executeSelectPoint(pointId: PointId, additive: boolean, editor: EditorAPI): void {
  if (additive) {
    const current = editor.getSelectedPoints();
    editor.selectPoints([...current, pointId]);
  } else {
    editor.clearSelection();
    editor.selectPoints([pointId]);
  }
}

function executeSelectAnchor(anchorId: AnchorId, additive: boolean, editor: EditorAPI): void {
  if (additive) {
    const current = editor.getSelectedAnchors();
    editor.selectAnchors([...current, anchorId]);
  } else {
    editor.clearSelection();
    editor.selectAnchors([anchorId]);
  }
}

function executeSelectSegment(
  segmentId: SegmentId,
  additive: boolean,
  editor: EditorAPI,
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
    editor.clearSelection();
    editor.selectSegments([segmentId]);
    editor.selectPoints(pointIds);
  }

  return pointIds;
}

function executeToggleSegment(segmentId: SegmentId, editor: EditorAPI): PointId[] {
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

function executeSelectPointsInRect(rect: Rect2D, editor: EditorAPI): PointId[] {
  const allPoints = editor.getAllPoints();
  const hitPoints = allPoints.filter((p) => pointInRect(p, rect));
  const pointIds = hitPoints.map((p) => p.id);
  editor.clearSelection();
  editor.selectPoints(pointIds);
  return pointIds;
}

function executeScalePoints(
  pointIds: PointId[],
  sx: number,
  sy: number,
  anchor: Point2D,
  editor: EditorAPI,
): void {
  if (sx !== 1 || sy !== 1) {
    const cmd = new ScalePointsCommand(pointIds, sx, sy, anchor);
    editor.commands.execute(cmd);
  }
}

function executeRotatePoints(
  pointIds: PointId[],
  angle: number,
  center: Point2D,
  editor: EditorAPI,
): void {
  if (angle !== 0) {
    const cmd = new RotatePointsCommand(pointIds, angle, center);
    editor.commands.execute(cmd);
  }
}

function executeMoveSelectionDelta(
  pointIds: PointId[],
  anchorIds: AnchorId[],
  delta: Point2D,
  editor: EditorAPI,
): void {
  const updates: NodePositionUpdate[] = [];

  if (pointIds.length > 0) {
    const selectedPointIds = new Set(pointIds);
    for (const point of editor.getAllPoints()) {
      if (!selectedPointIds.has(point.id)) {
        continue;
      }
      updates.push({
        node: { kind: "point", id: point.id },
        x: point.x + delta.x,
        y: point.y + delta.y,
      });
    }
  }

  if (anchorIds.length > 0) {
    const glyph = editor.glyph.peek();
    if (glyph) {
      const selectedAnchorIds = new Set(anchorIds);
      for (const anchor of glyph.anchors) {
        if (!selectedAnchorIds.has(anchor.id)) {
          continue;
        }
        updates.push({
          node: { kind: "anchor", id: anchor.id },
          x: anchor.x + delta.x,
          y: anchor.y + delta.y,
        });
      }
    }
  }

  if (updates.length > 0) {
    editor.setNodePositions(updates);
  }
}

function executeNudge(pointIds: PointId[], dx: number, dy: number, editor: EditorAPI): void {
  if (pointIds.length === 0) return;
  const cmd = new NudgePointsCommand(pointIds, dx, dy);
  editor.commands.execute(cmd);
}

function executeUpgradeLineToCubic(segment: LineSegment, editor: EditorAPI): void {
  const cmd = new UpgradeLineToCubicCommand(segment);
  editor.commands.execute(cmd);
}

function executeSelectContour(contourId: ContourId, additive: boolean, editor: EditorAPI): void {
  const glyph = editor.glyph.peek();
  if (!glyph) return;

  const contour = glyph.contours.find((c) => c.id === contourId);
  if (!contour) return;

  const pointIds = contour.points.map((p) => p.id);

  if (!additive) {
    editor.clearSelection();
  }
  editor.selectPoints(pointIds);
}

function executeEditTextRunSlot(index: number, point: Point2D, editor: EditorAPI): void {
  const textRunState = editor.getTextRunState();
  if (!textRunState) return;

  const slot = textRunState.layout.slots[index];
  if (!slot) return;

  const composite = editor.getGlyphCompositeComponents(slot.glyph.glyphName);
  const isComposite = !!composite && composite.components.length > 0;
  const isInspected = textRunState.compositeInspection?.slotIndex === index;

  if (isComposite && !isInspected) {
    editor.setTextRunInspectionSlot(index);
    editor.setTextRunInspectionComponent(null);
    editor.setTextRunEditingSlot(null);
    return;
  }

  const localPoint = { x: point.x - slot.x, y: point.y };
  const hit = resolveComponentAtPoint(composite, localPoint);
  const hitComponent = hit?.component ?? null;

  if (hitComponent) {
    const insertedGlyph: GlyphRef = {
      glyphName: hitComponent.componentGlyphName,
      unicode: hitComponent.sourceUnicodes[0] ?? null,
    };

    const insertedIndex = index + 1;
    editor.insertTextGlyphAt(insertedIndex, insertedGlyph);
    editor.recomputeTextRun();

    const nextState = editor.getTextRunState();
    const insertedSlot = nextState?.layout.slots[insertedIndex];
    const slotX = insertedSlot?.x ?? slot.x;

    editor.startEditSession(insertedGlyph);
    editor.setDrawOffsetForGlyph({ x: slotX, y: 0 }, insertedGlyph);
    editor.setPreviewMode(false);
    editor.setTextRunEditingSlot(insertedIndex, insertedGlyph);
    editor.clearTextRunInspection();
    return;
  }

  if (isComposite) {
    editor.setTextRunInspectionComponent(null);
    return;
  }

  editor.startEditSession(slot.glyph);
  editor.setDrawOffsetForGlyph({ x: slot.x, y: 0 }, slot.glyph);
  editor.setPreviewMode(false);
  editor.setTextRunEditingSlot(index, slot.glyph);
  editor.clearTextRunInspection();
}
