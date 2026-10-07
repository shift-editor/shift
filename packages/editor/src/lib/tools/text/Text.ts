import type { TextRunNode } from "../../../types/node";
import { BaseTool, type ToolName } from "../core/BaseTool";
import { TypingBehavior } from "./behaviors/TypingBehavior";
import type { TextBehavior, TextState } from "./types";
import type { CursorType } from "../../../types/editor";
import type { Subject } from "../../../types/inspector";
import { track } from "../../signals";

/**
 * Text mode: edits a run's text with every glyph drawn filled.
 *
 * @remarks
 * Activating suspends glyph editing and resumes the run's kept caret and
 * selection, or places the caret after the run's child glyph. Deactivating
 * keeps the caret for the next visit and restores glyph editing.
 */
export class TextTool extends BaseTool<TextState> {
  readonly id: ToolName = "text";
  readonly behaviors: TextBehavior[] = [new TypingBehavior()];

  #restoreEditing: (() => void) | null = null;

  override getCursor(state: TextState): CursorType {
    return state.type === "idle" ? { type: "default" } : { type: "text" };
  }

  initialState(): TextState {
    return { type: "idle" };
  }

  override activate(): void {
    const run = this.#run();
    this.#restoreEditing = this.editor.editing.suspend();
    if (!run) {
      this.setState({ type: "ready" });
      return;
    }

    const items = this.editor.text.items(run);
    const childItemId = this.editor.nodeDefinition("textRun").childGlyph(run)?.itemId;
    this.editor.textEditing.resume(run.id, childItemId ?? items[items.length - 1]?.id ?? null);
    this.setState({ type: "editing" });
  }

  protected override isEditing(state: TextState): boolean {
    return state.type === "editing";
  }

  /** The run being typed in, plus the glyphs the caret targets. */
  override subject(): Subject | null {
    track(this.editor.textEditing.stateCell);
    const state = this.editor.textEditing.state;
    const node = this.editor.scene.nodeOfKind(state?.nodeId ?? null, "textRun");
    if (!node) return null;

    return { node, parts: this.editor.textEditing.targetItems().map((item) => item.id) };
  }

  override deactivate(): void {
    this.editor.textEditing.end();
    if (this.#restoreEditing) this.#restoreEditing();
    this.#restoreEditing = null;
    this.setState({ type: "idle" });
  }

  /** The run holding the edited glyph, or the canvas's only run. */
  #run(): TextRunNode | null {
    for (const id of this.editor.editing.nodeIds) {
      const run = this.editor.scene.nodeOfKind(this.editor.scene.parent(id)?.id ?? null, "textRun");
      if (run) return run;
    }
    return this.editor.scene.nodesOfKind("textRun")[0] ?? null;
  }
}
