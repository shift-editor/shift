import type { AnchorId, Point2D, PointId } from "@shift/types";
import type { ToolEvent } from "../../core/GestureDetector";
import type { DragTarget, EditorAPI } from "../../core/EditorAPI";
import type { TransitionResult } from "../../core/Behavior";
import type { SelectState, SelectBehavior } from "../types";
import type { SelectAction } from "../actions";
import { Segment as SegmentOps } from "@/lib/geo/Segment";
import { getPointIdFromHit, isAnchorHit, isSegmentHit } from "@/types/hitResult";
import type { DragSnapSession } from "@/lib/editor/snapping/types";

type TranslatingState = Extract<SelectState, { type: "translating" }>;

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
      editor.clearHover();
    }

    if (prev.type === "translating" && next.type !== "translating") {
      this.clearSnap();
      editor.setSnapIndicator(null);
    }
  }

  private transitionTranslating(
    state: TranslatingState,
    event: ToolEvent,
    editor: EditorAPI,
  ): TransitionResult<SelectState, SelectAction> {
    if (event.type === "drag") {
      let newLastPos = event.point;

      if (this.#snap) {
        const result = this.#snap.snap(event.point, { shiftKey: event.shiftKey });
        newLastPos = result.point;
        editor.setSnapIndicator(result.indicator);
      }

      const deltaX = newLastPos.x - state.translate.lastPos.x;
      const deltaY = newLastPos.y - state.translate.lastPos.y;

      state.translate.session.update({
        pointer: newLastPos,
        modifiers: { shiftKey: event.shiftKey, altKey: event.altKey, metaKey: false },
      });

      state.translate.lastPos = { x: newLastPos.x, y: newLastPos.y };
      state.translate.totalDelta = {
        x: state.translate.totalDelta.x + deltaX,
        y: state.translate.totalDelta.y + deltaY,
      };

      return { state };
    }

    if (event.type === "dragEnd") {
      const { totalDelta, draggedPointIds, draggedAnchorIds } = state.translate;
      const nothingDragged = draggedPointIds.length === 0 && draggedAnchorIds.length === 0;
      const noMovement = totalDelta.x === 0 && totalDelta.y === 0;

      if (nothingDragged || noMovement) {
        state.translate.session.cancel();
        return { state: { type: "selected" } };
      }

      state.translate.session.commit();
      return { state: { type: "selected" } };
    }

    if (event.type === "dragCancel") {
      state.translate.session.cancel();
      return {
        state: { type: "selected" },
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
    const anchorId = isAnchorHit(hit) ? hit.anchorId : null;

    if (anchorId !== null) {
      const isSelected = state.type === "selected" && editor.isAnchorSelected(anchorId);

      if (!isSelected) {
        const draggedPointIds: PointId[] = [];
        const draggedAnchorIds = [anchorId];
        let anchorPos = event.point;
        return {
          state: this.beginTranslating(editor, anchorPos, draggedPointIds, draggedAnchorIds),
          action: { type: "selectAnchor", anchorId, additive: false },
        };
      }

      const draggedPointIds = editor.getSelectedPoints();
      const draggedAnchorIds = editor.getSelectedAnchors();
      const snapAnchorPointId = draggedPointIds[0] ?? null;
      let anchorPos = event.point;
      if (snapAnchorPointId !== null) {
        anchorPos = this.startSnap(editor, snapAnchorPointId, event.point, draggedPointIds);
      }
      return {
        state: this.beginTranslating(editor, anchorPos, draggedPointIds, draggedAnchorIds),
      };
    }

    if (pointId !== null) {
      const isSelected = state.type === "selected" && editor.isPointSelected(pointId);

      if (event.altKey && isSelected) {
        const result = this.startDuplicateDrag(editor, event.point);
        if (result) return result;
      }

      const draggedPointIds = isSelected ? editor.getSelectedPoints() : [pointId];
      const draggedAnchorIds = isSelected ? editor.getSelectedAnchors() : [];
      const anchorPos = this.startSnap(editor, pointId, event.point, draggedPointIds);

      return {
        state: this.beginTranslating(editor, anchorPos, draggedPointIds, draggedAnchorIds),
        ...(isSelected ? {} : { action: { type: "selectPoint", pointId, additive: false } }),
      };
    }

    if (isSegmentHit(hit)) {
      const pointIds = SegmentOps.getPointIds(hit.segment);
      const isSelected = state.type === "selected" && editor.isSegmentSelected(hit.segmentId);

      if (event.altKey && isSelected) {
        const result = this.startDuplicateDrag(editor, event.point);
        if (result) return result;
      }

      const draggedPointIds = isSelected ? editor.getSelectedPoints() : pointIds;
      const draggedAnchorIds = isSelected ? editor.getSelectedAnchors() : [];
      const anchorPointId = draggedPointIds[0];
      if (!anchorPointId) return null;

      const anchorPos = this.startSnap(editor, anchorPointId, event.point, draggedPointIds);

      return {
        state: this.beginTranslating(editor, anchorPos, draggedPointIds, draggedAnchorIds),
        ...(isSelected
          ? {}
          : {
              action: {
                type: "selectSegment",
                segmentId: hit.segmentId,
                additive: false,
              },
            }),
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
      state: this.beginTranslating(editor, anchorPos, newPointIds, []),
      action: { type: "selectPoints", pointIds: newPointIds },
    };
  }

  private beginTranslating(
    editor: EditorAPI,
    startPointer: Point2D,
    draggedPointIds: PointId[],
    draggedAnchorIds: AnchorId[],
  ): TranslatingState {
    const session = editor.beginDrag(
      this.createDragTarget(draggedPointIds, draggedAnchorIds),
      startPointer,
    );
    return {
      type: "translating",
      translate: {
        session,
        lastPos: startPointer,
        totalDelta: { x: 0, y: 0 },
        draggedPointIds,
        draggedAnchorIds,
      },
    };
  }

  private createDragTarget(pointIds: PointId[], anchorIds: AnchorId[]): DragTarget {
    return {
      pointIds,
      anchorIds,
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
