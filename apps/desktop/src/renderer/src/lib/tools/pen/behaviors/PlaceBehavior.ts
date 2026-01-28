import type { Point2D, ContourId, PointId } from "@shift/types";
import { Vec2 } from "@shift/geo";
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
    const glyph = editor.edit.getGlyph();
    if (!glyph) return false;

    const activeContourId = editor.edit.getActiveContourId();
    const activeContour = glyph.contours.find((c) => c.id === activeContourId);

    return activeContour !== undefined && !activeContour.closed && activeContour.points.length > 0;
  }

  private shouldCloseContour(pos: Point2D, editor: Editor): boolean {
    const glyph = editor.edit.getGlyph();
    const activeContourId = editor.edit.getActiveContourId();
    const activeContour = glyph?.contours.find((c) => c.id === activeContourId);

    if (!activeContour || activeContour.closed || activeContour.points.length < 2) {
      return false;
    }

    const firstPoint = activeContour.points[0];
    return Vec2.isWithin(pos, firstPoint, editor.screen.hitRadius);
  }

  private getMiddlePointAt(
    pos: Point2D,
    editor: Editor,
  ): { contourId: ContourId; pointId: PointId; pointIndex: number } | null {
    const glyph = editor.edit.getGlyph();
    if (!glyph) return null;

    const activeContourId = editor.edit.getActiveContourId();
    const hitRadius = editor.screen.hitRadius;

    for (const contour of glyph.contours) {
      if (contour.id === activeContourId || contour.closed) continue;
      if (contour.points.length < 3) continue;

      for (let i = 1; i < contour.points.length - 1; i++) {
        const point = contour.points[i];
        const dist = Vec2.dist(pos, point);
        if (dist < hitRadius) {
          return {
            contourId: contour.id as ContourId,
            pointId: point.id as PointId,
            pointIndex: i,
          };
        }
      }
    }
    return null;
  }

  private buildContourContext(editor: Editor): ContourContext {
    const glyph = editor.edit.getGlyph();
    if (!glyph) {
      return {
        previousPointType: "none",
        previousOnCurvePosition: null,
        isFirstPoint: true,
      };
    }

    const activeContourId = editor.edit.getActiveContourId();
    const activeContour = glyph.contours.find((c) => c.id === activeContourId);
    if (!activeContour || activeContour.points.length === 0) {
      return {
        previousPointType: "none",
        previousOnCurvePosition: null,
        isFirstPoint: true,
      };
    }

    const points = activeContour.points;
    const lastPoint = points[points.length - 1];

    let previousOnCurvePosition: Point2D | null = null;
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].pointType === "onCurve") {
        previousOnCurvePosition = { x: points[i].x, y: points[i].y };
        break;
      }
    }

    return {
      previousPointType: lastPoint.pointType === "offCurve" ? "offCurve" : "onCurve",
      previousOnCurvePosition,
      isFirstPoint: false,
    };
  }
}
