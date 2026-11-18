import type { ClickEvent } from "../../core/GestureDetector";
import type { ToolContext } from "../../core/Behavior";
import type { SelectBehavior, SelectState } from "../types";
import { objectIsKindOf } from "../../../../types/object";

export class UpgradeSegment implements SelectBehavior {
  onClick(state: SelectState, ctx: ToolContext<SelectState>, event: ClickEvent): boolean {
    if (state.type !== "ready" || !event.metaKey) return false;
    if (event.target.kind !== "segment") return false;

    const object = ctx.editor.object(event.target.id);
    if (!objectIsKindOf(object, "segment")) return false;

    const layer = object.layer;
    if (!layer || !ctx.editor.isEditingLayer(layer)) return false;

    return layer.upgradeLineToCubic(object.segmentId);
  }
}
