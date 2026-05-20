import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import { PenStroke } from "../PenStroke";
import { PenTargets } from "../PenTargets";
import type { PenState, PenBehavior } from "../types";

export class PenDownBehaviour implements PenBehavior {
  onClick(state: PenState, ctx: ToolContext<PenState>, event: ToolEventOf<"click">): boolean {
    if (state.type !== "ready") return false;

    const editor = ctx.editor;
    const stroke = PenStroke.active(editor);
    if (!stroke) return false;

    const localPoint = event.coords.glyphLocal;
    const targets = PenTargets.forStroke(stroke);
    const target = targets.at(localPoint, editor.hitRadius);

    editor.selection.clear();

    const isActive = editor.getActiveContour() !== null;

    switch (target.type) {
      case "terminal":
        if (isActive) {
          stroke.closeActiveContour();
        } else {
          stroke.continueContour(target.contourId, target.side, target.pointId);
        }

        ctx.setState({ type: "ready" });
        return true;

      case "segment":
        if (!stroke.splitSegment(target.segmentId, target.t)) return false;
        ctx.setState({ type: "ready" });
        return true;

      case "empty":
        if (stroke.activeContour) {
          stroke.appendOnCurve(localPoint);
        } else {
          stroke.startContour(localPoint);
        }

        ctx.setState({ type: "ready" });
        return true;
    }
  }

  onDragStart(
    state: PenState,
    ctx: ToolContext<PenState>,
    event: ToolEventOf<"dragStart">,
  ): boolean {
    if (state.type !== "ready") return false;

    const editor = ctx.editor;
    const targets = PenTargets.active(editor);
    if (!targets) return false;

    const target = targets.at(event.coords.glyphLocal, editor.hitRadius);
    if (target.type === "segment") return false;

    const activeContour = editor.getActiveContour();
    if (!activeContour) return false;

    ctx.setState({
      type: "anchored",
      anchor: { position: event.coords.glyphLocal },
    });
    return true;
  }
}
