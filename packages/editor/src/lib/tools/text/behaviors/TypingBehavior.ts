import type {
  ClickEvent,
  DoubleClickEvent,
  DragEvent,
  DragStartEvent,
  KeyDownEvent,
  PointerMoveEvent,
} from "../../core/GestureDetector";
import type { ToolContext } from "../../core/Behavior";
import type { TextBehavior, TextState } from "../types";

/** Resolves canvas gestures into placed-run creation and caret positions. */
export class TypingBehavior implements TextBehavior {
  onClick(state: TextState, ctx: ToolContext<TextState>, event: ClickEvent): boolean {
    return this.#click(state, ctx, event);
  }

  onDoubleClick(state: TextState, ctx: ToolContext<TextState>, event: DoubleClickEvent): boolean {
    return this.#click(state, ctx, event);
  }

  #click(
    state: TextState,
    ctx: ToolContext<TextState>,
    event: ClickEvent | DoubleClickEvent,
  ): boolean {
    if (state.type === "idle") return false;
    if (event.target.kind === "text") {
      if (ctx.editor.textEditing.state?.nodeId !== event.target.node.id) {
        ctx.editor.textEditing.begin(event.target.node.id);
      }
      ctx.editor.textEditing.placeAtCluster(event.target.cluster, event.shiftKey);
    } else {
      const run = ctx.editor.text.createRun([]);
      const node = ctx.editor.scene.createNode({
        kind: "textRun",
        runId: run.id,
        size: ctx.editor.font.metricsCell.peek().unitsPerEm,
        position: event.coords.scene,
      });
      ctx.editor.textEditing.begin(node.id);
    }
    ctx.setState({ type: "editing" });
    return true;
  }

  onPointerMove(state: TextState, ctx: ToolContext<TextState>, event: PointerMoveEvent): boolean {
    if (state.type === "idle") return false;
    const target = event.target;
    ctx.editor.textEditing.setHoveredItem(target.kind === "text" ? target.itemId : null);
    return target.kind === "text";
  }

  onDragStart(state: TextState, ctx: ToolContext<TextState>, event: DragStartEvent): boolean {
    if (state.type === "idle" || event.target.kind !== "text") return false;
    const nodeId = event.target.node.id;
    if (ctx.editor.textEditing.state?.nodeId !== nodeId) ctx.editor.textEditing.begin(nodeId);
    ctx.editor.textEditing.placeAtCluster(event.target.cluster);
    ctx.setState({ type: "editing" });
    return true;
  }

  onDrag(state: TextState, ctx: ToolContext<TextState>, event: DragEvent): boolean {
    if (
      state.type !== "editing" ||
      event.target.kind !== "text" ||
      event.target.node.id !== ctx.editor.textEditing.state?.nodeId
    )
      return false;
    ctx.editor.textEditing.placeAtCluster(event.target.cluster, true);
    return true;
  }

  onKeyDown(state: TextState, ctx: ToolContext<TextState>, event: KeyDownEvent): boolean {
    if (state.type === "idle" || event.key !== "Escape") return false;
    ctx.editor.setActiveTool("select");
    return true;
  }
}
