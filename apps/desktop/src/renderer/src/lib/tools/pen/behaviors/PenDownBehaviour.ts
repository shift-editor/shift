import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { PenState, PenBehavior } from "../types";
import { PenStroke } from "./PenStroke";

export class PenDownBehaviour implements PenBehavior {
  onClick(state: PenState, ctx: ToolContext<PenState>, event: ToolEventOf<"click">): boolean {
    if (state.type !== "ready") return false;

    const editor = ctx.editor;
    const stroke = PenStroke.active(editor);
    if (!stroke) return false;

    const localPoint = event.coords.glyphLocal;
    const activeContour = stroke.activeContour;

    editor.selection.clear();

    const hit = editor.hitTest(event.coords);

    if (!activeContour && !hit) {
      stroke.startContour(localPoint);
      ctx.setState({ type: "ready", mousePos: localPoint });
      return true;
    }

    if (activeContour && stroke.canClose(localPoint, editor.hitRadius)) {
      stroke.closeActiveContour();
      ctx.setState({ type: "ready", mousePos: localPoint });
      return true;
    }

    if (hit) {
      switch (hit.type) {
        case "contourEndpoint":
          editor.continueContour(hit.contourId, hit.position === "start", hit.pointId);
          ctx.setState({ type: "ready", mousePos: localPoint });
          return true;

        case "segment":
          editor.splitSegment(hit.segment, hit.t);
          ctx.setState({ type: "ready", mousePos: localPoint });
          return true;
      }
    }

    if (!activeContour) return false;

    stroke.appendOnCurve(localPoint);
    ctx.setState({ type: "ready", mousePos: localPoint });
    return true;
  }

  onDragStart(
    state: PenState,
    ctx: ToolContext<PenState>,
    event: ToolEventOf<"dragStart">,
  ): boolean {
    if (state.type !== "ready") return false;

    const editor = ctx.editor;
    const hit = editor.hitTest(event.coords);

    if (hit && (hit.type === "segment" || hit.type === "middlePoint")) {
      return false;
    }

    const activeContour = editor.getActiveContour();
    if (!activeContour) return false;

    ctx.setState({
      type: "anchored",
      anchor: { position: event.coords.glyphLocal },
    });
    return true;
  }
}
