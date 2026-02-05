import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { SelectState, SelectBehavior } from "../types";
import { isSegmentHit } from "@/types/hitResult";

export class UpgradeSegmentBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    return (
      (state.type === "ready" || state.type === "selected") &&
      event.type === "click" &&
      event.altKey
    );
  }

  transition(state: SelectState, event: ToolEvent, editor: ToolContext): SelectState | null {
    if (event.type !== "click" || !event.altKey) return null;

    const hit = editor.getNodeAt(event.point);
    if (!isSegmentHit(hit) || hit.segment.type !== "line") return null;

    return {
      type: state.type === "selected" ? "selected" : "ready",
      intent: { action: "upgradeLineToCubic", segment: hit.segment },
    };
  }
}
