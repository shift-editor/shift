import { Vec2 } from "@shift/geo";
import type { PointId, GlyphSnapshot } from "@shift/types";
import type { ToolEvent } from "../../core/GestureDetector";
import type { Editor } from "@/lib/editor";
import type { SelectState, SelectBehavior } from "../types";
import { Segment as SegmentOps } from "@/lib/geo/Segment";
import { ContentResolver } from "@/lib/clipboard/ContentResolver";

export class DragBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    if (state.type === "dragging") {
      return event.type === "drag" || event.type === "dragEnd" || event.type === "dragCancel";
    }
    if ((state.type === "ready" || state.type === "selected") && event.type === "dragStart") {
      return true;
    }
    return false;
  }

  transition(state: SelectState, event: ToolEvent, editor: Editor): SelectState | null {
    if (state.type === "dragging") {
      return this.transitionDragging(state, event);
    }

    if ((state.type === "ready" || state.type === "selected") && event.type === "dragStart") {
      return this.tryStartDrag(state, event, editor);
    }

    return null;
  }

  onTransition(prev: SelectState, next: SelectState, _event: ToolEvent, editor: Editor): void {
    if (prev.type !== "dragging" && next.type === "dragging") {
      editor.preview.beginPreview();
      editor.hover.clearAll();
    }
  }

  private transitionDragging(
    state: SelectState & { type: "dragging" },
    event: ToolEvent,
  ): SelectState {
    if (event.type === "drag") {
      const delta = Vec2.sub(event.point, state.drag.lastPos);
      return {
        type: "dragging",
        drag: {
          ...state.drag,
          lastPos: event.point,
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
    editor: Editor,
  ): SelectState | null {
    const point = editor.hitTest.getPointAt(event.point);

    if (point) {
      const pointId = point.id;
      const isSelected = state.type === "selected" && editor.selection.isPointSelected(pointId);

      if (event.altKey && isSelected) {
        const newPointIds = this.duplicateSelection(editor);
        if (newPointIds.length > 0) {
          return {
            type: "dragging",
            drag: {
              anchorPointId: newPointIds[0],
              startPos: event.point,
              lastPos: event.point,
              totalDelta: { x: 0, y: 0 },
              draggedPointIds: newPointIds,
            },
            intent: { action: "selectPoints", pointIds: newPointIds },
          };
        }
      }

      const draggedPointIds = isSelected ? [...editor.selection.getSelectedPoints()] : [pointId];

      return {
        type: "dragging",
        drag: {
          anchorPointId: pointId,
          startPos: event.point,
          lastPos: event.point,
          totalDelta: { x: 0, y: 0 },
          draggedPointIds,
        },
        intent: isSelected ? undefined : { action: "selectPoint", pointId, additive: false },
      };
    }

    const segmentHit = editor.hitTest.getSegmentAt(event.point);
    if (segmentHit) {
      const segment = editor.hitTest.getSegmentById(segmentHit.segmentId);
      const pointIds = segment ? SegmentOps.getPointIds(segment) : [];

      const isSelected =
        state.type === "selected" && editor.selection.isSegmentSelected(segmentHit.segmentId);

      if (event.altKey && isSelected) {
        const newPointIds = this.duplicateSelection(editor);
        if (newPointIds.length > 0) {
          return {
            type: "dragging",
            drag: {
              anchorPointId: newPointIds[0],
              startPos: event.point,
              lastPos: event.point,
              totalDelta: { x: 0, y: 0 },
              draggedPointIds: newPointIds,
            },
            intent: { action: "selectPoints", pointIds: newPointIds },
          };
        }
      }

      const draggedPointIds = isSelected ? [...editor.selection.getSelectedPoints()] : pointIds;

      return {
        type: "dragging",
        drag: {
          anchorPointId: draggedPointIds[0],
          startPos: event.point,
          lastPos: event.point,
          totalDelta: { x: 0, y: 0 },
          draggedPointIds,
        },
        intent: isSelected
          ? undefined
          : {
              action: "selectSegment",
              segmentId: segmentHit.segmentId,
              additive: false,
            },
      };
    }

    return null;
  }

  private duplicateSelection(editor: Editor): PointId[] {
    const glyph = editor.getGlyph();
    if (!glyph) return [];

    const selectedPointIds = [...editor.selection.getSelectedPoints()];
    const selectedSegmentIds = [...editor.selection.getSelectedSegments()];

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
