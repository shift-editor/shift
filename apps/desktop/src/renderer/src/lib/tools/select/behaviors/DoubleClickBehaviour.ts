import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { TransitionResult } from "../../core/Behavior";
import type { SelectState, SelectBehavior } from "../types";
import type { SelectAction } from "../actions";
import type { ContourId } from "@shift/types";
import { Segment as SegmentOps } from "@/lib/geo/Segment";
import { isSegmentHit } from "@/types/hitResult";

export class DoubleClickBehaviour implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    return (state.type === "ready" || state.type === "selected") && event.type === "doubleClick";
  }

  transition(
    _state: SelectState,
    event: ToolEvent,
    editor: ToolContext,
  ): TransitionResult<SelectState, SelectAction> | null {
    if (event.type !== "doubleClick") return null;

    const hit = editor.getNodeAt(event.point);
    if (!isSegmentHit(hit)) return null;

    const contourId = this.findContourForSegment(hit.segmentId, editor);
    if (!contourId) return null;

    return {
      state: { type: "selected" },
      action: { type: "selectContour", contourId, additive: false },
    };
  }

  private findContourForSegment(segmentId: string, editor: ToolContext): ContourId | null {
    const glyph = editor.getActiveGlyph();
    if (!glyph) return null;

    for (const contour of glyph.contours) {
      const segments = SegmentOps.parse(contour.points, contour.closed);
      for (const seg of segments) {
        if (SegmentOps.id(seg) === segmentId) {
          return contour.id;
        }
      }
    }
    return null;
  }
}
