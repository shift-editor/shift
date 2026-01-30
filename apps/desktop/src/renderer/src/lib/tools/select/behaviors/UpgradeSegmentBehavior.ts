import type { ToolEvent } from "../../core/GestureDetector";
import type { Editor } from "@/lib/editor";
import type { SelectState, SelectBehavior } from "../types";

export class UpgradeSegmentBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    return (
      (state.type === "ready" || state.type === "selected") &&
      event.type === "click" &&
      event.altKey
    );
  }

  transition(state: SelectState, event: ToolEvent, editor: Editor): SelectState | null {
    if (event.type !== "click" || !event.altKey) return null;

    if (editor.hitTest.getPointAt(event.point)) return null;

    const segmentHit = editor.hitTest.getSegmentAt(event.point);
    if (!segmentHit) return null;

    const segment = editor.hitTest.getSegmentById(segmentHit.segmentId);
    if (!segment || segment.type !== "line") return null;

    return {
      type: state.type === "selected" ? "selected" : "ready",
      hoveredPointId: state.type === "selected" ? state.hoveredPointId : null,
      intent: { action: "upgradeLineToCubic", segment },
    };
  }

  onTransition(): void {}
}
