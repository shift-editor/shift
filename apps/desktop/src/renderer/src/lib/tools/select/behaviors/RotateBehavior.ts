import { Vec2 } from "@shift/geo";
import type { ToolEvent } from "../../core/GestureDetector";
import type { EditorAPI } from "../../core/EditorAPI";
import type { TransitionResult } from "../../core/Behavior";
import type { SelectState, SelectBehavior } from "../types";
import type { SelectAction } from "../actions";
import type { CornerHandle } from "@/types/boundingBox";
import type { RotateSnapSession } from "@/lib/editor/snapping/types";
import { cacheSelectedPositions } from "../utils";
import type { NodePositionUpdate } from "@/types/positionUpdate";

export class RotateBehavior implements SelectBehavior {
  #snap: RotateSnapSession | null = null;

  canHandle(state: SelectState, event: ToolEvent): boolean {
    if (state.type === "rotating") {
      return event.type === "drag" || event.type === "dragEnd" || event.type === "dragCancel";
    }
    if (state.type === "selected" && event.type === "dragStart") {
      return true;
    }
    return false;
  }

  transition(
    state: SelectState,
    event: ToolEvent,
    editor: EditorAPI,
  ): TransitionResult<SelectState, SelectAction> | null {
    if (state.type === "rotating") {
      return this.transitionRotating(state, event, editor);
    }

    if (state.type === "selected" && event.type === "dragStart") {
      return this.tryStartRotate(state, event, editor);
    }

    return null;
  }

  onTransition(prev: SelectState, next: SelectState, _event: ToolEvent, editor: EditorAPI): void {
    if (prev.type !== "rotating" && next.type === "rotating") {
      editor.setHandlesVisible(false);
      editor.clearHover();
    }
    if (prev.type === "rotating" && next.type !== "rotating") {
      this.clearSnap();
      editor.setHandlesVisible(true);
    }
  }

  private transitionRotating(
    state: SelectState & { type: "rotating" },
    event: ToolEvent,
    _editor: EditorAPI,
  ): TransitionResult<SelectState, SelectAction> {
    if (event.type === "drag") {
      const currentPos = event.coords.glyphLocal;
      const rawAngle = Vec2.angleTo(state.rotate.center, currentPos);
      const rawDelta = rawAngle - state.rotate.startAngle;

      let deltaAngle = rawDelta;
      let snappedAngle: number | undefined;

      if (this.#snap) {
        const snapResult = this.#snap.snap(rawDelta, { shiftKey: event.shiftKey });
        deltaAngle = snapResult.delta;
        if (snapResult.source === "angle") snappedAngle = snapResult.delta;
      }

      const currentAngle = state.rotate.startAngle + deltaAngle;

      const updates: NodePositionUpdate[] = [];
      for (const [id, initialPos] of state.rotate.initialPositions) {
        const rotated = Vec2.rotateAround(initialPos, state.rotate.center, deltaAngle);
        updates.push({ node: { kind: "point", id }, x: rotated.x, y: rotated.y });
      }
      state.rotate.preview.preview(updates);
      state.rotate.lastPos = currentPos;
      state.rotate.currentAngle = currentAngle;
      state.rotate.latestUpdates = updates;
      if (snappedAngle !== undefined) {
        state.rotate.snappedAngle = snappedAngle;
      } else {
        delete state.rotate.snappedAngle;
      }

      return { state };
    }

    if (event.type === "dragEnd") {
      const totalAngle = state.rotate.currentAngle - state.rotate.startAngle;
      if (totalAngle !== 0) {
        state.rotate.preview.commit();
      } else {
        state.rotate.preview.cancel();
      }

      return {
        state: { type: "selected" },
      };
    }

    if (event.type === "dragCancel") {
      state.rotate.preview.cancel();
      return {
        state: { type: "selected" },
      };
    }

    return { state };
  }

  private tryStartRotate(
    _state: SelectState & { type: "selected" },
    event: ToolEvent & { type: "dragStart" },
    editor: EditorAPI,
  ): TransitionResult<SelectState, SelectAction> | null {
    const point = editor.getPointAt(event.coords);
    if (point) return null;

    const bbHit = editor.hitTestBoundingBoxAt(event.coords);
    const corner: CornerHandle | null = bbHit?.type === "rotate" ? bbHit.corner : null;
    const bounds = editor.getSelectionBoundingRect();
    const baseGlyph = editor.glyph.peek();

    if (!corner || !bounds || !baseGlyph) return null;

    const localPoint = event.coords.glyphLocal;
    const center = Vec2.midpoint(
      { x: bounds.left, y: bounds.top },
      { x: bounds.right, y: bounds.bottom },
    );

    const startAngle = Vec2.angleTo(center, localPoint);
    const draggedPointIds = [...editor.getSelectedPoints()];
    this.startSnap(editor);
    const initialPositions = cacheSelectedPositions(editor);

    return {
      state: {
        type: "rotating",
        rotate: {
          preview: editor.beginNodePositionPreview("Rotate Points", baseGlyph),
          corner,
          startPos: localPoint,
          lastPos: localPoint,
          center,
          startAngle,
          currentAngle: startAngle,
          draggedPointIds,
          initialPositions,
          latestUpdates: [],
        },
      },
    };
  }

  private startSnap(editor: EditorAPI): void {
    this.clearSnap();
    this.#snap = editor.createRotateSnapSession();
  }

  private clearSnap(): void {
    if (this.#snap) this.#snap.clear();
    this.#snap = null;
  }
}
