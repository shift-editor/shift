import type { TextCaret } from "../../../types/text";
import type { TextRunNode } from "../../../types/node";
import { BaseTool, type ToolName } from "../core/BaseTool";
import { TypingBehavior } from "./behaviors/TypingBehavior";
import type { TextBehavior, TextState } from "./types";
import type { CursorType } from "../../../types/editor";

const LAST_CARET_KEY = "lastCaret";

/** Caret and selection kept between Text mode visits; tool instances do not outlive a visit. */
interface LastCaret {
  readonly anchor: TextCaret;
  readonly focus: TextCaret;
}

/**
 * Text mode: edits the page run's text with every glyph drawn filled.
 *
 * @remarks
 * Activating clears glyph editing and restores the caret and selection from
 * the last visit, or places the caret after the run's child glyph when those
 * items are gone. Deactivating ends text editing and re-enters the stashed nodes.
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
    this.#restoreEditing = this.editor.editing.suspend();

    const run = this.#run();
    if (!run) {
      this.setState({ type: "ready" });
      return;
    }

    const items = this.editor.text.run(run.runId)?.items ?? [];
    const exists = (caret: TextCaret) => caret === null || items.some((item) => item.id === caret);
    const last = this.editor.getToolState("document", this.id, LAST_CARET_KEY) as
      | LastCaret
      | undefined;
    if (last && exists(last.anchor) && exists(last.focus)) {
      this.editor.textEditing.begin(run.id, last.focus, last.anchor);
    } else {
      const caret =
        this.editor.runChildren.glyph(run)?.itemId ?? items[items.length - 1]?.id ?? null;
      this.editor.textEditing.begin(run.id, caret);
    }
    this.setState({ type: "editing" });
  }

  /** The run holding the edited glyph, or the page's only run. */
  #run(): TextRunNode | null {
    for (const id of this.editor.editing.nodeIds) {
      const run = this.editor.scene.nodeOfKind(
        this.editor.scene.node(id)?.parentId ?? null,
        "textRun",
      );
      if (run) return run;
    }
    return this.editor.scene.nodesOfKind("textRun")[0] ?? null;
  }

  protected override isEditing(state: TextState): boolean {
    return state.type === "editing";
  }

  override deactivate(): void {
    const state = this.editor.textEditing.state;
    if (state) {
      const last: LastCaret = { anchor: state.anchor, focus: state.focus };
      this.editor.setToolState("document", this.id, LAST_CARET_KEY, last);
    }
    this.editor.textEditing.end();
    if (this.#restoreEditing) this.#restoreEditing();
    this.#restoreEditing = null;
    this.setState({ type: "idle" });
  }
}
