import type { ToolEvent } from "../../core/GestureDetector";
import type { Editor } from "@/lib/editor";
import type { SelectState, SelectBehavior } from "../types";
import type { ContourId, PointSnapshot } from "@shift/types";
import { Segment as SegmentOps } from "@/lib/geo/Segment";

export class DoubleClickSelectContourBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    return (state.type === "ready" || state.type === "selected") && event.type === "doubleClick";
  }

  transition(_state: SelectState, event: ToolEvent, editor: Editor): SelectState | null {
    if (event.type !== "doubleClick") return null;

    const point = editor.hitTest.getPointAt(event.point);
    if (point) return null;

    const segmentHit = editor.hitTest.getSegmentAt(event.point);
    if (!segmentHit) return null;

    const contourId = this.findContourForSegment(segmentHit.segmentId, editor);
    if (!contourId) return null;

    return {
      type: "selected",
      intent: { action: "selectContour", contourId, additive: false },
    };
  }

  onTransition(): void {}

  private findContourForSegment(segmentId: string, editor: Editor): ContourId | null {
    const glyph = editor.getGlyph();
    if (!glyph) return null;

    for (const contour of glyph.contours) {
      const segments = SegmentOps.parse([...contour.points] as PointSnapshot[], contour.closed);
      for (const seg of segments) {
        if (SegmentOps.id(seg) === segmentId) {
          return contour.id;
        }
      }
    }
    return null;
  }
}
