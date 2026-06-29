import type { ClickEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/Behavior";
import type { SelectBehavior, SelectState } from "../types";

export class UpgradeSegment implements SelectBehavior {
  onClick(state: SelectState, ctx: ToolContext<SelectState>, event: ClickEvent): boolean {
    void ctx;
    void event;
    if (state.type !== "ready" || !event.altKey) return false;
    return false;
  }
}
