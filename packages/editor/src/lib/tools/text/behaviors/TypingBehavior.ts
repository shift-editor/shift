import type {
  ClickEvent,
  DoubleClickEvent,
  DragEvent,
  DragStartEvent,
  KeyDownEvent,
} from "../../core/GestureDetector";
import type { ToolContext } from "../../core/Behavior";
import type { TextBehavior, TextState } from "../types";
import type { ScenePoint } from "../../../../types/coordinates";

/** Resolves canvas gestures inside the page run into caret positions; clicks elsewhere do nothing. */
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
    const caret = caretAt(ctx, event.coords.scene);
    if (!caret) return false;
    ctx.editor.textEditing.placeAtCluster(caret.cluster, event.shiftKey);
    ctx.setState({ type: "editing" });
    return true;
  }

  onDragStart(state: TextState, ctx: ToolContext<TextState>, event: DragStartEvent): boolean {
    if (state.type === "idle") return false;
    const caret = caretAt(ctx, event.origin.scene);
    if (!caret) return false;
    ctx.editor.textEditing.placeAtCluster(caret.cluster);
    ctx.setState({ type: "editing" });
    return true;
  }

  onDrag(state: TextState, ctx: ToolContext<TextState>, event: DragEvent): boolean {
    if (state.type !== "editing") return false;
    const caret = caretAt(ctx, event.coords.scene);
    if (!caret) return false;
    ctx.editor.textEditing.placeAtCluster(caret.cluster, true);
    return true;
  }

  onKeyDown(state: TextState, ctx: ToolContext<TextState>, event: KeyDownEvent): boolean {
    if (state.type === "idle" || event.key !== "Escape") return false;
    ctx.editor.setActiveTool("select");
    return true;
  }
}

/** Returns the caret cluster at a scene point in the run being edited. */
function caretAt(ctx: ToolContext<TextState>, point: ScenePoint): { cluster: number } | null {
  const editor = ctx.editor;
  const run = editor.scene.nodeOfKind(editor.textEditing.state?.nodeId ?? null, "textRun");
  if (!run) return null;
  const cluster = editor.nodeDefinition("textRun").caretAt(run, editor.toLocal(run, point));
  return cluster === null ? null : { cluster };
}
