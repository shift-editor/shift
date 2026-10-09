import { Bounds, Rect, type Rect2D } from "@shift/geo";
import type { SelectableId } from "@shift/types";
import { sceneBounds } from "../../../editor/spaces";
import type { ToolContext } from "../../core/Behavior";
import type { DragEndEvent, DragEvent, DragStartEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";

export class Marquee implements SelectBehavior {
  onDragStart(state: SelectState, ctx: ToolContext<SelectState>, event: DragStartEvent): boolean {
    if (state.type !== "ready") return false;

    const initialSelection = ctx.editor.selection.ids;
    if (!event.shiftKey && ctx.editor.selection.hasSelection()) {
      ctx.editor.selection.clear();
    }

    ctx.setState({
      type: "brushing",
      selection: {
        startPos: event.origin.scene,
        currentPos: event.coords.scene,
        initialSelection,
      },
    });

    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState>, event: DragEvent): boolean {
    if (state.type !== "brushing") return false;

    const rect = Rect.fromPoints(state.selection.startPos, event.coords.scene);
    this.selectIdsInRect(rect, ctx, event.shiftKey ? state.selection.initialSelection : []);

    ctx.setState({
      type: "brushing",
      selection: { ...state.selection, currentPos: event.coords.scene },
    });
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>, event: DragEndEvent): boolean {
    if (state.type !== "brushing") return false;

    const rect = Rect.fromPoints(state.selection.startPos, event.coords.scene);
    this.selectIdsInRect(rect, ctx, event.shiftKey ? state.selection.initialSelection : []);

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "brushing") return false;

    ctx.editor.selection.clear();
    ctx.setState({ type: "ready" });
    return true;
  }

  /** Asks each scene node's definition what the rect catches inside it. */
  private getIdsInRect(rect: Rect2D, ctx: ToolContext<SelectState>): Set<SelectableId> {
    const editor = ctx.editor;
    const sceneRect = sceneBounds(Bounds.fromXYWH(rect.x, rect.y, rect.width, rect.height));
    const ids = new Set<SelectableId>();
    for (const node of editor.scene.nodes()) {
      const localRect = editor.toLocalBounds(node, sceneRect);
      for (const id of editor.nodeDefinition(node.kind).idsInRect(node, localRect)) ids.add(id);
    }
    return ids;
  }

  private selectIdsInRect(
    rect: Rect2D,
    ctx: ToolContext<SelectState>,
    initialSelection: readonly SelectableId[],
  ): void {
    if (ctx.editor.sessionMode === "preview") {
      ctx.editor.selection.clear();
      return;
    }

    const ids = this.getIdsInRect(rect, ctx);
    ctx.editor.selection.select([...initialSelection, ...ids]);
  }
}
