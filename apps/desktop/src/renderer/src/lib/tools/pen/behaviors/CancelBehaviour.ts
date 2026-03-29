import { Contours } from "@shift/font";
import type { ToolContext } from "../../core/Behavior";
import type { EditorAPI } from "../../core/EditorAPI";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { PenState, PenBehavior } from "../types";

export class EscapeBehavior implements PenBehavior {
  onKeyDown(state: PenState, ctx: ToolContext<PenState>, event: ToolEventOf<"keyDown">): boolean {
    if (state.type !== "ready") return false;
    if (event.key !== "Escape") return false;

    if (this.hasActiveDrawingContour(ctx.editor)) {
      // abandonPenContour(ctx.editor);
      return true;
    }

    return false;
  }

  private hasActiveDrawingContour(editor: EditorAPI): boolean {
    const contour = editor.getActiveContour();
    if (!contour) return false;
    return Contours.isOpen(contour) && !Contours.isEmpty(contour);
  }
}
