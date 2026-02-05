import { Vec2 } from "@shift/geo";
import type { Point2D, PointId, GlyphSnapshot } from "@shift/types";
import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { SelectState, SelectBehavior } from "../types";
import { Segment as SegmentOps } from "@/lib/geo/Segment";
import { ContentResolver } from "@/lib/clipboard/ContentResolver";
import { getPointIdFromHit, isSegmentHit } from "@/types/hitResult";
import type { DragSnapSession } from "@/lib/editor/snapping/types";

export class DragBehavior implements SelectBehavior {
  #snap: DragSnapSession | null = null;

  canHandle(state: SelectState, event: ToolEvent): boolean {
    if (state.type === "dragging") {
      return event.type === "drag" || event.type === "dragEnd" || event.type === "dragCancel";
    }
    if ((state.type === "ready" || state.type === "selected") && event.type === "dragStart") {
      return true;
    }
    return false;
  }

  transition(state: SelectState, event: ToolEvent, editor: ToolContext): SelectState | null {
    if (state.type === "dragging") {
      return this.transitionDragging(state, event, editor);
    }

    if ((state.type === "ready" || state.type === "selected") && event.type === "dragStart") {
      return this.tryStartDrag(state, event, editor);
    }

    return null;
  }

  onTransition(prev: SelectState, next: SelectState, _event: ToolEvent, editor: ToolContext): void {
    if (prev.type !== "dragging" && next.type === "dragging") {
      editor.beginPreview();
      editor.clearHover();
    }

    if (prev.type === "dragging" && next.type !== "dragging") {
      this.clearSnap();
      editor.setSnapIndicator(null);
    }
  }

  private transitionDragging(
    state: SelectState & { type: "dragging" },
    event: ToolEvent,
    _editor: ToolContext,
  ): SelectState {
    if (event.type === "drag") {
      let newLastPos = event.point;

      if (this.#snap) {
        const result = this.#snap.snap(event.point, { shiftKey: event.shiftKey });
        newLastPos = result.point;
        _editor.setSnapIndicator(result.indicator);
      }

      const delta = Vec2.sub(newLastPos, state.drag.lastPos);
      return {
        type: "dragging",
        drag: {
          ...state.drag,
          lastPos: { x: newLastPos.x, y: newLastPos.y },
          totalDelta: Vec2.add(state.drag.totalDelta, delta),
        },
        intent: { action: "movePointsDelta", delta },
      };
    }

    if (event.type === "dragEnd") {
      const { totalDelta, draggedPointIds } = state.drag;
      const hasMoved = (totalDelta.x !== 0 || totalDelta.y !== 0) && draggedPointIds.length > 0;

      return {
        type: "selected",
        intent: hasMoved
          ? { action: "commitPreview", label: "Move Points" }
          : { action: "cancelPreview" },
      };
    }

    if (event.type === "dragCancel") {
      return {
        type: "selected",
        intent: { action: "cancelPreview" },
      };
    }

    return state;
  }

  private tryStartDrag(
    state: SelectState & { type: "ready" | "selected" },
    event: ToolEvent & { type: "dragStart" },
    editor: ToolContext,
  ): SelectState | null {
    const hit = editor.getNodeAt(event.point);
    const pointId = getPointIdFromHit(hit);

    if (pointId !== null) {
      const isSelected = state.type === "selected" && editor.isPointSelected(pointId);

      if (event.altKey && isSelected) {
        const newPointIds = this.duplicateSelection(editor);
        const firstPointId = newPointIds[0];
        if (firstPointId) {
          const anchorPos = this.startSnap(editor, firstPointId, event.point, newPointIds);
          return {
            type: "dragging",
            drag: {
              anchorPointId: firstPointId,
              startPos: event.point,
              lastPos: anchorPos,
              totalDelta: { x: 0, y: 0 },
              draggedPointIds: newPointIds,
            },
            intent: { action: "selectPoints", pointIds: newPointIds },
          };
        }
      }

      const draggedPointIds = isSelected ? [...editor.getSelectedPoints()] : [pointId];
      const anchorPos = this.startSnap(editor, pointId, event.point, draggedPointIds);

      return {
        type: "dragging",
        drag: {
          anchorPointId: pointId,
          startPos: event.point,
          lastPos: anchorPos,
          totalDelta: { x: 0, y: 0 },
          draggedPointIds,
        },
        intent: isSelected ? undefined : { action: "selectPoint", pointId, additive: false },
      };
    }

    if (isSegmentHit(hit)) {
      const pointIds = SegmentOps.getPointIds(hit.segment);
      const isSelected = state.type === "selected" && editor.isSegmentSelected(hit.segmentId);

      if (event.altKey && isSelected) {
        const newPointIds = this.duplicateSelection(editor);
        const firstPointId = newPointIds[0];
        if (firstPointId) {
          const anchorPos = this.startSnap(editor, firstPointId, event.point, newPointIds);
          return {
            type: "dragging",
            drag: {
              anchorPointId: firstPointId,
              startPos: event.point,
              lastPos: anchorPos,
              totalDelta: { x: 0, y: 0 },
              draggedPointIds: newPointIds,
            },
            intent: { action: "selectPoints", pointIds: newPointIds },
          };
        }
      }

      const draggedPointIds = isSelected ? [...editor.getSelectedPoints()] : pointIds;
      const anchorPointId = draggedPointIds[0];
      if (!anchorPointId) return null;

      const anchorPos = this.startSnap(editor, anchorPointId, event.point, draggedPointIds);

      return {
        type: "dragging",
        drag: {
          anchorPointId,
          startPos: event.point,
          lastPos: anchorPos,
          totalDelta: { x: 0, y: 0 },
          draggedPointIds,
        },
        intent: isSelected
          ? undefined
          : {
              action: "selectSegment",
              segmentId: hit.segmentId,
              additive: false,
            },
      };
    }

    return null;
  }

  private startSnap(
    editor: ToolContext,
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

  private duplicateSelection(editor: ToolContext): PointId[] {
    const glyph = editor.getGlyph();
    if (!glyph) return [];

    const selectedPointIds = [...editor.getSelectedPoints()];
    const selectedSegmentIds = [...editor.getSelectedSegments()];

    const resolver = new ContentResolver();
    const content = resolver.resolve(
      glyph as unknown as GlyphSnapshot,
      selectedPointIds,
      selectedSegmentIds,
    );

    if (!content || content.contours.length === 0) return [];

    const contoursJson = JSON.stringify(content.contours);
    const result = editor.fontEngine.editing.pasteContours(contoursJson, 0, 0);

    return result.success ? result.createdPointIds : [];
  }
}
