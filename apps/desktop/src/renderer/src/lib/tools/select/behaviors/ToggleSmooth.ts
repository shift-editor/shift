import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import { Validate } from "@shift/validation";
import { ToggleSmoothCommand } from "@/lib/commands/primitives";

export class ToggleSmooth implements SelectBehavior {
  onDoubleClick(
    state: SelectState,
    ctx: ToolContext<SelectState>,
    event: ToolEventOf<"doubleClick">,
  ): boolean {
    if (state.type !== "ready" && ctx.editor.selection.hasSelection()) return false;
    const instance = ctx.editor.previewGlyphInstance;
    if (!instance || !ctx.editor.editingGlyphLayer) return false;

    const geometry = instance.geometry;
    const hit = geometry.hitPoint(event.coords.glyphLocal, ctx.editor.hitRadius);
    if (!hit) return false;

    const pointId = hit.pointId;
    const point = geometry.point(hit.pointId);
    if (!point || !Validate.isOnCurve(point)) return false;

    ctx.editor.commands.run(new ToggleSmoothCommand(pointId));
    return true;
  }
}
