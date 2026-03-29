import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { EditorAPI } from "../../core/EditorAPI";
import type { SelectHandlerBehavior, SelectState } from "../types";
import type { PointId, AnchorId } from "@shift/types";
import type { SegmentId } from "@/types/indicator";
import { Segments as SegmentOps } from "@/lib/geo/Segments";
import { getPointIdFromHit, isAnchorHit, isSegmentHit } from "@/types/hitResult";

function nextSelectionStateAfterToggle(
  isSelected: boolean,
  selectedInTypeCount: number,
  selectedInOtherTypesCount: number,
): "ready" | "selected" {
  const nextInTypeCount = selectedInTypeCount + (isSelected ? -1 : 1);
  return nextInTypeCount + selectedInOtherTypesCount > 0 ? "selected" : "ready";
}

export class SelectionBehavior implements SelectHandlerBehavior {
  onClick(state: SelectState, ctx: ToolContext<SelectState>, event: ToolEventOf<"click">): boolean {
    if (state.type !== "ready" && state.type !== "selected") return false;
    const editor = ctx.editor;

    const hit = editor.getNodeAt(event.coords);
    const pointId = getPointIdFromHit(hit);
    const anchorId = isAnchorHit(hit) ? hit.anchorId : null;

    // Anchor hit + shift toggle
    if (anchorId !== null && state.type === "selected" && event.shiftKey) {
      const selectedPoints = editor.getSelectedPoints();
      const selectedAnchors = editor.getSelectedAnchors();
      const selectedSegments = editor.getSelectedSegments();
      const isSelected = editor.isAnchorSelected(anchorId);
      const type = nextSelectionStateAfterToggle(
        isSelected,
        selectedAnchors.length,
        selectedPoints.length + selectedSegments.length,
      );
      editor.toggleAnchorSelection(anchorId);
      ctx.setState({ type });
      return true;
    }

    if (anchorId !== null) {
      this.selectAnchor(editor, anchorId, event.shiftKey);
      ctx.setState({ type: "selected" });
      return true;
    }

    // Point hit + shift toggle
    if (pointId !== null && state.type === "selected" && event.shiftKey) {
      const selectedPoints = editor.getSelectedPoints();
      const selectedAnchors = editor.getSelectedAnchors();
      const selectedSegments = editor.getSelectedSegments();
      const isSelected = editor.isPointSelected(pointId);
      const type = nextSelectionStateAfterToggle(
        isSelected,
        selectedPoints.length,
        selectedAnchors.length + selectedSegments.length,
      );
      editor.togglePointSelection(pointId);
      ctx.setState({ type });
      return true;
    }

    if (pointId !== null) {
      this.selectPoint(editor, pointId, event.shiftKey);
      ctx.setState({ type: "selected" });
      return true;
    }

    // Segment hit + shift toggle
    if (hit !== null && isSegmentHit(hit) && state.type === "selected" && event.shiftKey) {
      const selectedPoints = editor.getSelectedPoints();
      const selectedAnchors = editor.getSelectedAnchors();
      const selectedSegments = editor.getSelectedSegments();
      const isSelected = editor.isSegmentSelected(hit.segmentId);
      const type = nextSelectionStateAfterToggle(
        isSelected,
        selectedSegments.length,
        selectedPoints.length + selectedAnchors.length,
      );
      this.toggleSegment(editor, hit.segmentId);
      ctx.setState({ type });
      return true;
    }

    // Segment hit (no shift)
    if (hit !== null && isSegmentHit(hit)) {
      this.selectSegment(editor, hit.segmentId, event.shiftKey);
      ctx.setState({ type: "selected" });
      return true;
    }

    // Clear selection if anything is selected
    if (state.type === "selected" || editor.hasSelection()) {
      editor.clearSelection();
      ctx.setState({ type: "ready" });
      return true;
    }

    return false;
  }

  private selectPoint(editor: EditorAPI, pointId: PointId, additive: boolean): void {
    if (additive) {
      const current = editor.getSelectedPoints();
      editor.selectPoints([...current, pointId]);
      return;
    }

    editor.clearSelection();
    editor.selectPoints([pointId]);
  }

  private selectAnchor(editor: EditorAPI, anchorId: AnchorId, additive: boolean): void {
    if (additive) {
      const current = editor.getSelectedAnchors();
      editor.selectAnchors([...current, anchorId]);
      return;
    }

    editor.clearSelection();
    editor.selectAnchors([anchorId]);
  }

  private selectSegment(editor: EditorAPI, segmentId: SegmentId, additive: boolean): void {
    const segment = editor.getSegmentById(segmentId);
    if (!segment) return;
    const pointIds = SegmentOps.getPointIds(segment);

    if (additive) {
      editor.addSegmentToSelection(segmentId);
      for (const pointId of pointIds) {
        editor.addPointToSelection(pointId);
      }
      return;
    }

    editor.clearSelection();
    editor.selectSegments([segmentId]);
    editor.selectPoints(pointIds);
  }

  private toggleSegment(editor: EditorAPI, segmentId: SegmentId): void {
    const wasSelected = editor.isSegmentSelected(segmentId);
    editor.toggleSegmentInSelection(segmentId);

    const segment = editor.getSegmentById(segmentId);
    if (!segment) return;
    const pointIds = SegmentOps.getPointIds(segment);

    for (const pointId of pointIds) {
      if (wasSelected) {
        editor.removePointFromSelection(pointId);
      } else {
        editor.addPointToSelection(pointId);
      }
    }
  }
}
