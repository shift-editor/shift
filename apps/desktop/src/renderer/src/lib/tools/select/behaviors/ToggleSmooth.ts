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
    if (state.type !== "ready" && ctx.editor.selection.hasSelection())
      return false;
    const source = ctx.editor.editGlyphSource;
    if (!source) return false;

    const geometry = source.geometry;
    const hit = geometry.hitPoint(
      event.coords.glyphLocal,
      ctx.editor.hitRadius,
    );
    if (!hit) return false;

    const pointId = hit.pointId;
    const point = geometry.point(hit.pointId);
    if (!point || !Validate.isOnCurve(point)) return false;

    ctx.editor.commandHistory.execute(new ToggleSmoothCommand(pointId));
    return true;
  }
}
