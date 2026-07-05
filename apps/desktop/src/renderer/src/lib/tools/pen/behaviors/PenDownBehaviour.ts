import type { ToolContext } from "../../core/Behavior";
import type { ClickEvent, DragStartEvent } from "../../core/GestureDetector";
import { PenStroke } from "../PenStroke";
import { PenTargets } from "../PenTargets";
import type { PenState, PenBehavior } from "../types";
import type { Pen } from "../Pen";

export class PenDownBehaviour implements PenBehavior {
  onClick(state: PenState, ctx: ToolContext<PenState, Pen>, event: ClickEvent): boolean {
    if (state.type !== "ready") return false;

    const editor = ctx.editor;
    const stroke = PenStroke.active(ctx.tool);
    if (!stroke) return false;

    const nodePoint = editor.getPointInNodeSpace(event.coords.scene, stroke.node.position);
    const targets = PenTargets.forGeometry(stroke.layer.geometry);
    const target = targets.at(nodePoint, editor.hitRadius);

    editor.selection.clear();

    const isActive = stroke.activeContour !== null;

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
          stroke.appendOnCurve(nodePoint);
        } else {
          stroke.startContour(nodePoint);
        }

        ctx.setState({ type: "ready" });
        return true;
    }
  }

  onDragStart(state: PenState, ctx: ToolContext<PenState, Pen>, event: DragStartEvent): boolean {
    if (state.type !== "ready") return false;

    const editor = ctx.editor;
    const stroke = PenStroke.active(ctx.tool);
    if (!stroke) return false;

    const nodePoint = editor.getPointInNodeSpace(event.coords.scene, stroke.node.position);
    const targets = PenTargets.forGeometry(stroke.layer.geometry);
    const target = targets.at(nodePoint, editor.hitRadius);
    if (target.type === "segment") return false;

    const activeContour = stroke.activeContour;
    if (!activeContour) return false;

    ctx.setState({
      type: "anchored",
      anchor: { position: nodePoint },
    });
    return true;
  }
}
