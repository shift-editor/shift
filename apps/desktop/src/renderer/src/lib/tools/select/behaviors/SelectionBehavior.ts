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
      const selectedPoints = editor.selection.pointIds;
      const selectedAnchors = editor.selection.anchorIds;
      const selectedSegments = editor.selection.segmentIds;
      const isSelected = editor.selection.isSelected({ kind: "anchor", id: anchorId });
      const type = nextSelectionStateAfterToggle(
        isSelected,
        selectedAnchors.size,
        selectedPoints.size + selectedSegments.size,
      );
      editor.selection.toggle({ kind: "anchor", id: anchorId });
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
      const selectedPoints = editor.selection.pointIds;
      const selectedAnchors = editor.selection.anchorIds;
      const selectedSegments = editor.selection.segmentIds;
      const isSelected = editor.selection.isSelected({ kind: "point", id: pointId });
      const type = nextSelectionStateAfterToggle(
        isSelected,
        selectedPoints.size,
        selectedAnchors.size + selectedSegments.size,
      );
      editor.selection.toggle({ kind: "point", id: pointId });
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
      const selectedPoints = editor.selection.pointIds;
      const selectedAnchors = editor.selection.anchorIds;
      const selectedSegments = editor.selection.segmentIds;
      const isSelected = editor.selection.isSelected({ kind: "segment", id: hit.segmentId });
      const type = nextSelectionStateAfterToggle(
        isSelected,
        selectedSegments.size,
        selectedPoints.size + selectedAnchors.size,
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
    if (state.type === "selected" || editor.selection.hasSelection()) {
      editor.selection.clear();
      ctx.setState({ type: "ready" });
      return true;
    }

    return false;
  }

  private selectPoint(editor: EditorAPI, pointId: PointId, additive: boolean): void {
    if (additive) {
      editor.selection.add({ kind: "point", id: pointId });
      return;
    }

    editor.selection.select([{ kind: "point", id: pointId }]);
  }

  private selectAnchor(editor: EditorAPI, anchorId: AnchorId, additive: boolean): void {
    if (additive) {
      editor.selection.add({ kind: "anchor", id: anchorId });
      return;
    }

    editor.selection.select([{ kind: "anchor", id: anchorId }]);
  }

  private selectSegment(editor: EditorAPI, segmentId: SegmentId, additive: boolean): void {
    const segment = editor.getSegmentById(segmentId);
    if (!segment) return;
    const pointIds = SegmentOps.getPointIds(segment);

    if (additive) {
      editor.selection.add({ kind: "segment", id: segmentId });
      for (const pointId of pointIds) {
        editor.selection.add({ kind: "point", id: pointId });
      }
      return;
    }

    editor.selection.select([
      { kind: "segment", id: segmentId },
      ...pointIds.map((id) => ({ kind: "point" as const, id })),
    ]);
  }

  private toggleSegment(editor: EditorAPI, segmentId: SegmentId): void {
    const wasSelected = editor.selection.isSelected({ kind: "segment", id: segmentId });
    editor.selection.toggle({ kind: "segment", id: segmentId });

    const segment = editor.getSegmentById(segmentId);
    if (!segment) return;
    const pointIds = SegmentOps.getPointIds(segment);

    for (const pointId of pointIds) {
      if (wasSelected) {
        editor.selection.remove({ kind: "point", id: pointId });
      } else {
        editor.selection.add({ kind: "point", id: pointId });
      }
    }
  }
}
