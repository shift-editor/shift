import type { Point2D, PointId } from "@shift/types";
import { Vec2, Contours } from "@shift/geo";
import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { PenState, PenBehavior, ContourContext } from "../types";
import { resolvePenIntent } from "../intents";

export class PlaceBehavior implements PenBehavior {
  canHandle(state: PenState, event: ToolEvent): boolean {
    return state.type === "ready" && (event.type === "click" || event.type === "dragStart");
  }

  transition(state: PenState, event: ToolEvent, editor: ToolContext): PenState | null {
    if (state.type !== "ready") return null;
    if (event.type !== "click" && event.type !== "dragStart") return null;

    const intent = resolvePenIntent(event.point, {
      getNodeAt: (pos) => editor.getNodeAt(pos),
      getActiveContourId: () => editor.getActiveContourId(),
      hasActiveDrawingContour: () => this.hasActiveDrawingContour(editor),
      shouldCloseContour: (p) => this.shouldCloseContour(p, editor),
    });

    if (intent.action === "placePoint" && event.type === "dragStart") {
      return {
        type: "anchored",
        anchor: {
          position: intent.pos,
          pointId: "" as PointId,
          context: this.buildContourContext(editor),
        },
        intent,
      };
    }

    return {
      type: "ready",
      mousePos: event.point,
      intent,
    };
  }

  onTransition(prev: PenState, next: PenState, _event: ToolEvent, editor: ToolContext): void {
    if (prev.type === "ready" && next.type === "anchored" && next.intent?.action === "placePoint") {
      editor.commands.beginBatch("Add Point");
    }
  }

  private hasActiveDrawingContour(editor: ToolContext): boolean {
    const contour = editor.getActiveContour();
    if (!contour) return false;
    return Contours.isOpen(contour) && !Contours.isEmpty(contour);
  }

  private shouldCloseContour(pos: Point2D, editor: ToolContext): boolean {
    const contour = editor.getActiveContour();
    if (!contour || contour.closed || contour.points.length < 2) {
      return false;
    }

    const firstPoint = Contours.firstPoint(contour);
    if (!firstPoint) return false;

    return Vec2.isWithin(pos, firstPoint, editor.hitRadius);
  }

  private buildContourContext(editor: ToolContext): ContourContext {
    const contour = editor.getActiveContour();
    if (!contour || Contours.isEmpty(contour)) {
      return {
        previousPointType: "none",
        previousOnCurvePosition: null,
        isFirstPoint: true,
      };
    }

    const lastPoint = Contours.lastPoint(contour);
    if (!lastPoint) {
      return {
        previousPointType: "none",
        previousOnCurvePosition: null,
        isFirstPoint: true,
      };
    }

    const lastOnCurve = Contours.lastOnCurvePoint(contour);
    const previousOnCurvePosition: Point2D | null = lastOnCurve
      ? { x: lastOnCurve.x, y: lastOnCurve.y }
      : null;

    return {
      previousPointType: lastPoint.pointType === "offCurve" ? "offCurve" : "onCurve",
      previousOnCurvePosition,
      isFirstPoint: false,
    };
  }
}
