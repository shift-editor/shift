import { Rect, Vec2, type Rect2D } from "@shift/geo";
import type { PointId } from "@shift/types";
import type { ToolContext } from "../../core/Behavior";
import type { DragEndEvent, DragEvent, DragStartEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

export class Marquee implements SelectBehavior {
  onDragStart(state: SelectState, ctx: ToolContext<SelectState>, event: DragStartEvent): boolean {
    if (state.type !== "ready") return false;

    if (ctx.editor.selection.hasSelection()) {
      ctx.editor.selection.clear();
    }

    ctx.setState({
      type: "brushing",
      selection: {
        startPos: event.origin.scene,
        currentPos: event.coords.scene,
      },
    });

    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState>, event: DragEvent): boolean {
    if (state.type !== "brushing") return false;

    const rect = Rect.fromPoints(state.selection.startPos, event.coords.scene);
    this.selectPointsInRect(rect, ctx);

    ctx.setState({
      type: "brushing",
      selection: { ...state.selection, currentPos: event.coords.scene },
    });
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>, event: DragEndEvent): boolean {
    if (state.type !== "brushing") return false;

    const rect = Rect.fromPoints(state.selection.startPos, event.coords.scene);
    this.selectPointsInRect(rect, ctx);

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "brushing") return false;

    ctx.editor.selection.clear();
    ctx.setState({ type: "ready" });
    return true;
  }

  private getPointsInRect(rect: Rect2D, ctx: ToolContext<SelectState>): Set<PointId> {
    const pointIds = new Set<PointId>();

    for (const node of ctx.editor.scene.nodesOfKind("glyph")) {
      const instance = ctx.editor.font.instance(node.glyphId, ctx.editor.designLocationCell);
      if (!instance) continue;

      for (const point of instance.geometry.allPoints) {
        const scenePoint = Vec2.add(point, node.position);
        if (!Rect.containsPoint(rect, scenePoint)) continue;

        pointIds.add(point.id);
      }
    }

    return pointIds;
  }

  private selectPointsInRect(rect: Rect2D, ctx: ToolContext<SelectState>): void {
    const pointIds = this.getPointsInRect(rect, ctx);
    ctx.editor.selection.select([...pointIds]);
  }
}
