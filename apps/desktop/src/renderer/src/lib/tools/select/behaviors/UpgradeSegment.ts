import type { ClickEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/Behavior";
import type { SelectBehavior, SelectState } from "../types";
import { objectIsKindOf } from "@/types";

export class UpgradeSegment implements SelectBehavior {
  onClick(state: SelectState, ctx: ToolContext<SelectState>, event: ClickEvent): boolean {
    if (state.type !== "ready" || !event.altKey) return false;
    if (event.target.kind !== "segment") return false;

    const object = ctx.editor.object(event.target.id);
    if (!objectIsKindOf(object, "segment")) return false;

    return object.layer.upgradeLineToCubic(object.segmentId);
  }
}
