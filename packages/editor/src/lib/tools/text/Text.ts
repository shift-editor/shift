import type { NodeId } from "@shift/types";
import type { TextRunNode } from "../../../types/node";
import { screenPoint } from "../../editor/spaces";
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
  /** A run this tool placed on an empty page, removed again if nothing is typed into it. */
  #placedRunId: NodeId | null = null;

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
    this.#removePlacedRunIfEmpty();
    if (this.#restoreEditing) this.#restoreEditing();
    this.#restoreEditing = null;
    this.setState({ type: "idle" });
  }

  /**
   * Places an empty run on a page that has none, so there is a caret to type at.
   *
   * @remarks
   * It starts at the left of the view, halfway down, where the user is looking;
   * before the canvas has a size, at the page's origin.
   * Placing it is not an undo step; the text typed into it is. Leaving the tool
   * with nothing typed removes it again.
   */
  #placeRun(): TextRunNode | null {
    const page = this.editor.pages.active;
    if (!page) return null;

    // Before the canvas has a size there is no view to aim at; the page's origin stands in.
    const { logicalWidth, logicalHeight } = this.editor.getCameraTransform();
    const start =
      logicalWidth > 0 && logicalHeight > 0
        ? this.editor.fromScreen(screenPoint(logicalWidth * 0.2, logicalHeight * 0.5)).scene
        : { x: 0, y: 0 };
    const run = this.editor.history.withoutRecording(() =>
      this.editor.scene.createNode<TextRunNode>({
        kind: "textRun",
        parentId: page.id,
        runId: this.editor.text.createRun([]).id,
        size: this.editor.font.metricsCell.peek().unitsPerEm,
        position: { x: start.x, y: start.y },
      }),
    );
    this.#placedRunId = run.id;
    return run;
  }

  #removePlacedRunIfEmpty(): void {
    const placed = this.#placedRunId
      ? this.editor.scene.nodeOfKind(this.#placedRunId, "textRun")
      : null;
    this.#placedRunId = null;
    if (!placed || this.editor.text.items(placed).length > 0) return;

    this.editor.history.withoutRecording(() => {
      this.editor.scene.deleteNode(placed.id);
      this.editor.text.deleteRun(placed.runId);
    });
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
