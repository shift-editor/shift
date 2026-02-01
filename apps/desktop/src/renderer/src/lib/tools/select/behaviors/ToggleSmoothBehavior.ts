import type { ToolEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/ToolContext";
import type { SelectState, SelectBehavior } from "../types";
import { getPointIdFromHit } from "@/types/hitResult";

export class ToggleSmoothBehavior implements SelectBehavior {
  canHandle(state: SelectState, event: ToolEvent): boolean {
    return (state.type === "ready" || state.type === "selected") && event.type === "doubleClick";
  }

  transition(state: SelectState, event: ToolEvent, editor: ToolContext): SelectState | null {
    if (event.type !== "doubleClick") return null;
    if (state.type !== "ready" && state.type !== "selected") return null;

    const hit = editor.getNodeAt(event.point);
    const pointId = getPointIdFromHit(hit);
    if (pointId === null) return null;

    const glyph = editor.getGlyph();
    const point = glyph?.contours.flatMap((c) => c.points).find((p) => p.id === pointId);
    if (!point || point.pointType !== "onCurve") return null;

    return {
      ...state,
      intent: { action: "toggleSmooth", pointId },
    };
  }
}
