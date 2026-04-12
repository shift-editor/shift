import { Contours } from "@shift/font";
import type { ToolContext } from "../../core/Behavior";
import type { ToolEventOf } from "../../core/GestureDetector";
import type { PenState, PenBehavior } from "../types";

export class PenDownBehaviour implements PenBehavior {
  onClick(state: PenState, ctx: ToolContext<PenState>, event: ToolEventOf<"click">): boolean {
    if (state.type !== "ready") return false;

    const editor = ctx.editor;
    const glyph = editor.glyph.peek();
    if (!glyph) return false;

    const localPoint = event.coords.glyphLocal;
    const activeContour = editor.getActiveContour();

    editor.selection.clear();

    const hit = editor.hitTest(event.coords);

    if (!activeContour && !hit) {
      const contourId = glyph.addContour();
      glyph.addPointToContour(contourId, {
        x: localPoint.x,
        y: localPoint.y,
        pointType: "onCurve",
        smooth: false,
      });
      ctx.setState({ type: "ready", mousePos: localPoint });
      return true;
    }

    if (activeContour && Contours.canClose(activeContour, localPoint, editor.hitRadius)) {
      glyph.closeContour();
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

    glyph.addPointToContour(activeContour.id, {
      x: localPoint.x,
      y: localPoint.y,
      pointType: "onCurve",
      smooth: false,
    });
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
