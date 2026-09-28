import { BaseTool, type ToolName } from "../core/BaseTool";
import { TypingBehavior } from "./behaviors/TypingBehavior";
import type { TextBehavior, TextState } from "./types";
import type { CursorType } from "../../../types/editor";

/** Creates and edits placed text runs; the session record owns the caret. */
export class TextTool extends BaseTool<TextState> {
  readonly id: ToolName = "text";
  readonly behaviors: TextBehavior[] = [new TypingBehavior()];

  override getCursor(state: TextState): CursorType {
    return state.type === "idle" ? { type: "default" } : { type: "text" };
  }

  initialState(): TextState {
    return { type: "idle" };
  }
  override activate(): void {
    this.setState({ type: "ready" });
  }
  protected override isEditing(state: TextState): boolean {
    return state.type === "editing";
  }

  override deactivate(): void {
    const editing = this.editor.textEditing.state;
    const node = this.editor.scene.nodeOfKind(editing?.nodeId ?? null, "textRun");
    this.editor.textEditing.end();
    if (node && this.editor.text.run(node.runId)?.items.length === 0) {
      const remove = () => {
        this.editor.scene.deleteNode(node.id);
        this.editor.text.deleteRun(node.runId);
      };
      if (this.editor.history.capturing) remove();
      else this.editor.history.capture("Discard empty text", remove);
    }
    this.setState({ type: "idle" });
  }
}
