import type { PointId, Point2D } from "@shift/types";
import { Vec2, Mat } from "@shift/geo";
import type { ToolEvent } from "../../core/GestureDetector";
import type { Editor } from "@/lib/editor";
import type { SelectState, SelectBehavior } from "../types";
import type { CornerHandle } from "@/types/boundingBox";
import { hitTestBoundingBox } from "../boundingBoxHitTest";
import { BOUNDING_BOX_HANDLE_STYLES } from "@/lib/styles/style";

export class RotateBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    if (state.type === "rotating") {
      return event.type === "drag" || event.type === "dragEnd" || event.type === "dragCancel";
    }
    if (state.type === "selected" && event.type === "dragStart") {
      return true;
    }
    return false;
  }

  transition(state: SelectState, event: ToolEvent, editor: Editor): SelectState | null {
    if (state.type === "rotating") {
      return this.transitionRotating(state, event, editor);
    }

    if (state.type === "selected" && event.type === "dragStart") {
      return this.tryStartRotate(state, event, editor);
    }

    return null;
  }

  onTransition(prev: SelectState, next: SelectState, event: ToolEvent, editor: Editor): void {
    if (prev.type !== "rotating" && next.type === "rotating") {
      editor.preview.beginPreview();
      editor.render.setHandlesVisible(false);
    }
    if (prev.type === "rotating" && next.type !== "rotating") {
      editor.render.setHandlesVisible(true);
      if (event.type !== "dragEnd") {
        editor.preview.cancelPreview();
      }
    }
  }

  private transitionRotating(
    state: SelectState & { type: "rotating" },
    event: ToolEvent,
    editor: Editor,
  ): SelectState {
    if (event.type === "drag") {
      const currentAngle = this.calculateAngle(event.point, state.rotate.center);
      const deltaAngle = currentAngle - state.rotate.startAngle;

      const moves: Array<{ id: PointId; x: number; y: number }> = [];
      for (const [id, initialPos] of state.rotate.initialPositions) {
        const rotated = this.rotatePoint(initialPos, deltaAngle, state.rotate.center);
        moves.push({ id, x: rotated.x, y: rotated.y });
      }
      editor.edit.setPointPositions(moves);

      return {
        type: "rotating",
        rotate: {
          ...state.rotate,
          lastPos: event.point,
          currentAngle,
        },
      };
    }

    if (event.type === "dragEnd") {
      const totalAngle = state.rotate.currentAngle - state.rotate.startAngle;

      return {
        type: "selected",
        hoveredPointId: null,
        intent: {
          action: "rotatePoints",
          pointIds: state.rotate.draggedPointIds,
          angle: totalAngle,
          center: state.rotate.center,
        },
      };
    }

    if (event.type === "dragCancel") {
      return {
        type: "selected",
        hoveredPointId: null,
        intent: { action: "cancelPreview" },
      };
    }

    return state;
  }

  private tryStartRotate(
    _state: SelectState & { type: "selected" },
    event: ToolEvent & { type: "dragStart" },
    editor: Editor,
  ): SelectState | null {
    const point = editor.hitTest.getPointAt(event.point);
    if (point) return null;

    const corner = this.hitTestRotationZone(event.point, editor);
    const bounds = editor.hitTest.getSelectionBoundingRect();

    if (!corner || !bounds) return null;

    const center = Vec2.midpoint(
      { x: bounds.left, y: bounds.top },
      { x: bounds.right, y: bounds.bottom },
    );

    const startAngle = this.calculateAngle(event.point, center);
    const draggedPointIds = [...editor.selection.getSelectedPoints()];

    const initialPositions = new Map<PointId, Point2D>();
    const glyph = editor.edit.getGlyph();
    const allPoints = glyph?.contours.flatMap((c) => c.points) ?? [];
    for (const p of allPoints) {
      if (editor.selection.isPointSelected(p.id as PointId)) {
        initialPositions.set(p.id as PointId, { x: p.x, y: p.y });
      }
    }

    return {
      type: "rotating",
      rotate: {
        corner,
        startPos: event.point,
        lastPos: event.point,
        center,
        startAngle,
        currentAngle: startAngle,
        draggedPointIds,
        initialPositions,
      },
    };
  }

  private hitTestRotationZone(pos: Point2D, editor: Editor): CornerHandle | null {
    const rect = editor.hitTest.getSelectionBoundingRect();
    if (!rect) return null;

    const hitRadius = editor.hitRadius;
    const handleOffset = editor.screenToUpmDistance(BOUNDING_BOX_HANDLE_STYLES.handle.offset);
    const rotationZoneOffset = editor.screenToUpmDistance(
      BOUNDING_BOX_HANDLE_STYLES.rotationZoneOffset,
    );

    const result = hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);

    if (result?.type === "rotate") {
      return result.corner;
    }

    return null;
  }

  private calculateAngle(point: Point2D, center: Point2D): number {
    return Math.atan2(point.y - center.y, point.x - center.x);
  }

  private rotatePoint(point: Point2D, angle: number, center: Point2D): Point2D {
    const toOrigin = Mat.Translate(-center.x, -center.y);
    const rotate = Mat.Rotate(angle);
    const fromOrigin = Mat.Translate(center.x, center.y);
    const composite = Mat.Compose(Mat.Compose(fromOrigin, rotate), toOrigin);
    return Mat.applyToPoint(composite, point);
  }
}
