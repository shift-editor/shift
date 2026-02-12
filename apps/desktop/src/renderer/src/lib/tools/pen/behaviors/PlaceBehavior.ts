import type { Point2D, PointId } from "@shift/types";
import { Vec2 } from "@shift/geo";
import { Contours } from "@shift/font";
import { Validate } from "@shift/validation";
import type { ToolEvent } from "../../core/GestureDetector";
import type { EditorAPI } from "../../core/EditorAPI";
import type { TransitionResult } from "../../core/Behavior";
import type { PenState, PenBehavior, ContourContext } from "../types";
import { resolvePenAction, type PenAction } from "../actions";

export class PlaceBehavior implements PenBehavior {
  canHandle(state: PenState, event: ToolEvent): boolean {
    return state.type === "ready" && (event.type === "click" || event.type === "dragStart");
  }

  transition(
    state: PenState,
    event: ToolEvent,
    editor: EditorAPI,
  ): TransitionResult<PenState, PenAction> | null {
    if (state.type !== "ready") return null;
    if (event.type !== "click" && event.type !== "dragStart") return null;

    const rawAction = resolvePenAction(event.coords, {
      getNodeAt: (coords) => editor.getNodeAt(coords),
      getActiveContourId: () => editor.getActiveContourId(),
      hasActiveDrawingContour: () => this.hasActiveDrawingContour(editor),
      shouldCloseContour: (coords) => this.shouldCloseContour(coords.glyphLocal, editor),
    });
    const localPoint = event.coords.glyphLocal;
    const action = rawAction;

    if (action.type === "placePoint" && event.type === "dragStart") {
      return {
        state: {
          type: "anchored",
          anchor: {
            position: action.pos,
            pointId: "" as PointId,
            context: this.buildContourContext(editor),
          },
        },
        action,
      };
    }

    return {
      state: {
        type: "ready",
        mousePos: localPoint,
      },
      action,
    };
  }

  onTransition(prev: PenState, next: PenState, _event: ToolEvent, editor: EditorAPI): void {
    if (prev.type === "ready" && next.type === "anchored") {
      editor.commands.beginBatch("Add Point");
    }
  }

  private hasActiveDrawingContour(editor: EditorAPI): boolean {
    const contour = editor.getActiveContour();
    if (!contour) return false;
    return Contours.isOpen(contour) && !Contours.isEmpty(contour);
  }

  private shouldCloseContour(localPos: Point2D, editor: EditorAPI): boolean {
    const contour = editor.getActiveContour();
    if (!contour || contour.closed || contour.points.length < 2) {
      return false;
    }
    const firstPoint = Contours.firstPoint(contour);
    if (!firstPoint) return false;

    return Vec2.isWithin(localPos, firstPoint, editor.hitRadius);
  }

  private buildContourContext(editor: EditorAPI): ContourContext {
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
      previousPointType: Validate.isOffCurve(lastPoint) ? "offCurve" : "onCurve",
      previousOnCurvePosition,
      isFirstPoint: false,
    };
  }
}
