import type { ToolEventOf } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/Behavior";
import type { SelectHandlerBehavior, SelectState } from "../types";
import { isSegmentHit } from "@/types/hitResult";

export class UpgradeSegmentBehavior implements SelectHandlerBehavior {
  onClick(state: SelectState, ctx: ToolContext<SelectState>, event: ToolEventOf<"click">): boolean {
    if ((state.type !== "ready" && state.type !== "selected") || !event.altKey) return false;

    const hit = ctx.editor.getNodeAt(event.coords);
    if (!isSegmentHit(hit) || hit.segment.type !== "line") return false;

    ctx.editor.upgradeLineToCubic(hit.segment);
    return true;
  }
}
