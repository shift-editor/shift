import type { Point2D, PointId } from "@shift/types";
import { Vec2, Contours } from "@shift/geo";
import type { ToolEvent } from "../../core/GestureDetector";
import type { Editor } from "@/lib/editor";
import type { PenState, PenBehavior, ContourContext } from "../types";
import { resolvePenIntent } from "../intents";

export class PlaceBehavior implements PenBehavior {
  canHandle(state: PenState, event: ToolEvent): boolean {
    return state.type === "ready" && (event.type === "click" || event.type === "dragStart");
  }

  transition(state: PenState, event: ToolEvent, editor: Editor): PenState | null {
    if (state.type !== "ready") return null;
    if (event.type !== "click" && event.type !== "dragStart") return null;

    const intent = resolvePenIntent(event.point, {
      hitTest: editor.hitTest,
      getActiveContourId: () => editor.edit.getActiveContourId(),
      hasActiveDrawingContour: () => this.hasActiveDrawingContour(editor),
      shouldCloseContour: (p) => this.shouldCloseContour(p, editor),
      getMiddlePointAt: (p) => this.getMiddlePointAt(p, editor),
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

  onTransition(prev: PenState, next: PenState, _event: ToolEvent, editor: Editor): void {
    if (prev.type === "ready" && next.type === "anchored" && next.intent?.action === "placePoint") {
      editor.commands.beginBatch("Add Point");
    }
  }

  private hasActiveDrawingContour(editor: Editor): boolean {
    const contour = editor.edit.getActiveContour();
    if (!contour) return false;
    return Contours.isOpen(contour) && !Contours.isEmpty(contour);
  }

  private shouldCloseContour(pos: Point2D, editor: Editor): boolean {
    const contour = editor.edit.getActiveContour();
    if (!contour || contour.closed || contour.points.length < 2) {
      return false;
    }

    const firstPoint = Contours.firstPoint(contour);
    if (!firstPoint) return false;

    return Vec2.isWithin(pos, firstPoint, editor.hitRadius);
  }

  private getMiddlePointAt(pos: Point2D, editor: Editor) {
    return editor.hitTest.getMiddlePointAt(pos);
  }

  private buildContourContext(editor: Editor): ContourContext {
    const contour = editor.edit.getActiveContour();
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
