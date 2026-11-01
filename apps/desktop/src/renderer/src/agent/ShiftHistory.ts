import {
  HistoryUnavailableError,
  type HistoryLocation,
  type HistoryRedo,
  type HistoryUndo,
} from "@shift/runtime";
import type { Editor } from "@shift/editor";
import type { EditLocation } from "@shift/wasm/protocol";

/**
 * One window's undo and redo, as Edit › Undo and Edit › Redo run them:
 * `Editor.undo` and `Editor.redo`, over the window's whole history.
 *
 * @remarks
 * A step replays as it does for the user: the document shows the page it was
 * made on (`Pages.reveal`), and the window reopens the tab holding it. The
 * answer carries where that was, as the reveal reported it. A preview has no
 * undo history (its Edit › Undo and Redo are disabled), so both refuse it.
 */
export class ShiftHistory {
  readonly #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  /**
   * Reverses the window's latest step.
   *
   * @throws {HistoryUnavailableError} for a preview.
   */
  async undo(): Promise<HistoryUndo> {
    const { replayed, location } = await this.#replay(() => this.#editor.undo());
    return { undone: replayed, location };
  }

  /**
   * Reapplies the window's latest undone step.
   *
   * @throws {HistoryUnavailableError} for a preview.
   */
  async redo(): Promise<HistoryRedo> {
    const { replayed, location } = await this.#replay(() => this.#editor.redo());
    return { redone: replayed, location };
  }

  async #replay(
    step: () => Promise<boolean>,
  ): Promise<{ replayed: boolean; location: HistoryLocation | null }> {
    if (this.#editor.sessionMode === "preview") throw new HistoryUnavailableError();

    // The replay reveals its page while it runs, before `step` settles.
    const shown: { location: EditLocation | null } = { location: null };
    const stop = this.#editor.pages.onReveal((location) => {
      shown.location = location;
    });
    try {
      const replayed = await step();
      const location = replayed && shown.location ? historyLocation(shown.location) : null;
      return { replayed, location };
    } finally {
      stop();
    }
  }
}

function historyLocation({ pageId, glyphIds, nodeIds }: EditLocation): HistoryLocation {
  return { pageId: pageId ?? null, glyphIds: [...glyphIds], nodeIds: [...nodeIds] };
}
