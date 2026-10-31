import type { TextRunNode } from "../../../types/node";
import { BaseTool, type ToolName } from "../core/BaseTool";
import { TypingBehavior } from "./behaviors/TypingBehavior";
import type { TextBehavior, TextState } from "./types";
import type { CursorType } from "../../../types/editor";

/**
 * Text mode: edits a run's text with every glyph drawn filled.
 *
 * @remarks
 * Activating suspends glyph editing and resumes the run's kept caret and
 * selection, or places the caret after the run's child glyph. On a page with
 * no run it places an empty one in view, so typing can start at once.
 * Deactivating keeps the caret for the next visit and restores glyph editing.
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
    const run = this.#run() ?? this.#placeRun();
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

  override deactivate(): void {
    this.editor.textEditing.end();
    if (this.#restoreEditing) this.#restoreEditing();
    this.#restoreEditing = null;
    this.setState({ type: "idle" });
  }

  /**
   * Places an empty run in view on a page that has none, so there is a caret to type at.
   *
   * @remarks
   * It starts at the camera's text insertion point, or at the page's origin
   * before the canvas has a size. The run is provisional: the text model
   * removes it again if editing leaves it with nothing typed.
   */
  #placeRun(): TextRunNode | null {
    const page = this.editor.scene.shownPage();
    if (!page) return null;

    const at = this.editor.camera.textInsertionPoint() ?? { x: 0, y: 0 };
    return this.editor.text.placeRun({ page, at, glyphs: [] });
  }

  /** The run holding the edited glyph, or the canvas's only run. */
  #run(): TextRunNode | null {
    for (const id of this.editor.editing.nodeIds) {
      const run = this.editor.scene.nodeOfKind(this.editor.scene.parent(id)?.id ?? null, "textRun");
      if (run) return run;
    }
    return this.editor.scene.first("textRun");
  }
}
