import { Vec2 } from "@shift/geo";
import type { Point2D, PointId } from "@shift/types";
import type { ToolEvent } from "../../core/GestureDetector";
import type { EditorAPI } from "../../core/EditorAPI";
import type { TransitionResult } from "../../core/Behavior";
import type { SelectState, SelectBehavior } from "../types";
import type { SelectAction } from "../actions";
import { Segment as SegmentOps } from "@/lib/geo/Segment";
import { getPointIdFromHit, isSegmentHit } from "@/types/hitResult";
import type { DragSnapSession } from "@/lib/editor/snapping/types";

export class TranslateBehavior implements SelectBehavior {
  #snap: DragSnapSession | null = null;

  canHandle(state: SelectState, event: ToolEvent): boolean {
    if (state.type === "translating") {
      return event.type === "drag" || event.type === "dragEnd" || event.type === "dragCancel";
    }
    if ((state.type === "ready" || state.type === "selected") && event.type === "dragStart") {
      return true;
    }
    return false;
  }

  transition(
    state: SelectState,
    event: ToolEvent,
    editor: EditorAPI,
  ): TransitionResult<SelectState, SelectAction> | null {
    if (state.type === "translating") {
      return this.transitionTranslating(state, event, editor);
    }

    if ((state.type === "ready" || state.type === "selected") && event.type === "dragStart") {
      return this.tryStartDrag(state, event, editor);
    }

    return null;
  }

  onTransition(prev: SelectState, next: SelectState, _event: ToolEvent, editor: EditorAPI): void {
    if (prev.type !== "translating" && next.type === "translating") {
      editor.beginPreview();
      editor.clearHover();
    }

    if (prev.type === "translating" && next.type !== "translating") {
      this.clearSnap();
      editor.setSnapIndicator(null);
    }
  }

  private transitionTranslating(
    state: SelectState & { type: "translating" },
    event: ToolEvent,
    _editor: EditorAPI,
  ): TransitionResult<SelectState, SelectAction> {
    if (event.type === "drag") {
      let newLastPos = event.point;

      if (this.#snap) {
        const result = this.#snap.snap(event.point, { shiftKey: event.shiftKey });
        newLastPos = result.point;
        _editor.setSnapIndicator(result.indicator);
      }

      const delta = Vec2.sub(newLastPos, state.translate.lastPos);
      return {
        state: {
          type: "translating",
          translate: {
            ...state.translate,
            lastPos: { x: newLastPos.x, y: newLastPos.y },
            totalDelta: Vec2.add(state.translate.totalDelta, delta),
          },
        },
        action: { type: "movePointsDelta", delta },
      };
    }

    if (event.type === "dragEnd") {
      const { totalDelta, draggedPointIds } = state.translate;
      const hasMoved = (totalDelta.x !== 0 || totalDelta.y !== 0) && draggedPointIds.length > 0;

      return {
        state: { type: "selected" },
        action: hasMoved
          ? { type: "commitPreview", label: "Move Points" }
          : { type: "cancelPreview" },
      };
    }

    if (event.type === "dragCancel") {
      return {
        state: { type: "selected" },
        action: { type: "cancelPreview" },
      };
    }

    return { state };
  }

  private tryStartDrag(
    state: SelectState & { type: "ready" | "selected" },
    event: ToolEvent & { type: "dragStart" },
    editor: EditorAPI,
  ): TransitionResult<SelectState, SelectAction> | null {
    const hit = editor.getNodeAt(event.coords);
    const pointId = getPointIdFromHit(hit);

    if (pointId !== null) {
      const isSelected = state.type === "selected" && editor.isPointSelected(pointId);

      if (event.altKey && isSelected) {
        const result = this.startDuplicateDrag(editor, event.point);
        if (result) return result;
      }

      const draggedPointIds = isSelected ? [...editor.getSelectedPoints()] : [pointId];
      const anchorPos = this.startSnap(editor, pointId, event.point, draggedPointIds);

      return {
        state: {
          type: "translating",
          translate: {
            anchorPointId: pointId,
            startPos: event.point,
            lastPos: anchorPos,
            totalDelta: { x: 0, y: 0 },
            draggedPointIds,
          },
        },
        action: isSelected ? undefined : { type: "selectPoint", pointId, additive: false },
      };
    }

    if (isSegmentHit(hit)) {
      const pointIds = SegmentOps.getPointIds(hit.segment);
      const isSelected = state.type === "selected" && editor.isSegmentSelected(hit.segmentId);

      if (event.altKey && isSelected) {
        const result = this.startDuplicateDrag(editor, event.point);
        if (result) return result;
      }

      const draggedPointIds = isSelected ? [...editor.getSelectedPoints()] : pointIds;
      const anchorPointId = draggedPointIds[0];
      if (!anchorPointId) return null;

      const anchorPos = this.startSnap(editor, anchorPointId, event.point, draggedPointIds);

      return {
        state: {
          type: "translating",
          translate: {
            anchorPointId,
            startPos: event.point,
            lastPos: anchorPos,
            totalDelta: { x: 0, y: 0 },
            draggedPointIds,
          },
        },
        action: isSelected
          ? undefined
          : {
              type: "selectSegment",
              segmentId: hit.segmentId,
              additive: false,
            },
      };
    }

    return null;
  }

  private startDuplicateDrag(
    editor: EditorAPI,
    startPos: Point2D,
  ): TransitionResult<SelectState, SelectAction> | null {
    const newPointIds = editor.duplicateSelection();
    const firstPointId = newPointIds[0];
    if (!firstPointId) return null;

    const anchorPos = this.startSnap(editor, firstPointId, startPos, newPointIds);
    return {
      state: {
        type: "translating",
        translate: {
          anchorPointId: firstPointId,
          startPos,
          lastPos: anchorPos,
          totalDelta: { x: 0, y: 0 },
          draggedPointIds: newPointIds,
        },
      },
      action: { type: "selectPoints", pointIds: newPointIds },
    };
  }

  private startSnap(
    editor: EditorAPI,
    anchorPointId: PointId,
    dragStart: Point2D,
    excludedPointIds: PointId[],
  ): Point2D {
    this.clearSnap();

    this.#snap = editor.createDragSnapSession({
      anchorPointId,
      dragStart,
      excludedPointIds,
    });

    return this.#snap.getAnchorPosition();
  }

  private clearSnap(): void {
    if (this.#snap) this.#snap.clear();
    this.#snap = null;
  }
}
