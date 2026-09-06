import type { LedgerEntryId } from "@shift/types";
import type { EditorDiff, HistoryItem, PendingEditId, SelectableId } from "@/types";
import type { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";
import { HistoryCapture } from "./HistoryCapture";
import type { Selection } from "./Selection";
import { sequenceDiff } from "./history/sequenceDiff";

const MAX_HISTORY_ITEMS = 100;

/**
 * Orders renderer-owned editor diffs with references to Rust document entries.
 *
 * @remarks
 * Document state pairs remain exclusively in the workspace ledger. This
 * session-local history stores only pending/stable ledger identities and
 * reversible editor diffs. Resetting an editor context drops this timeline and
 * clears selection without changing document history.
 */
export class EditorHistory {
  readonly #selection: Selection;
  readonly #edits: WorkspaceEditCoordinator | null;
  readonly #unsubscribeSelection: () => void;
  readonly #unsubscribeEdits: (() => void) | null;
  readonly #undoItems: HistoryItem[] = [];
  readonly #redoItems: HistoryItem[] = [];

  #capture: HistoryCapture | null = null;
  #captureSelection: readonly SelectableId[] = [];
  #captureDocument: PendingEditId | null = null;
  #applying = false;

  /**
   * @param selection - Renderer-owned ordered selection to diff and restore.
   * @param edits - Document replay authority, or null for a preview-only editor.
   */
  constructor(selection: Selection, edits: WorkspaceEditCoordinator | null) {
    this.#selection = selection;
    this.#edits = edits;
    this.#unsubscribeSelection = selection.subscribe((before, after) =>
      this.#selectionChanged(before, after),
    );
    this.#unsubscribeEdits =
      edits?.subscribeEdits((editId) => this.#documentAccepted(editId)) ?? null;
  }

  get capturing(): boolean {
    return this.#capture !== null;
  }

  /** Begins one action that may change editor values and at most one document entry. */
  beginCapture(): HistoryCapture {
    if (this.#capture) throw new Error("editor history already has an open capture");

    this.#captureSelection = this.#selection.ids;
    this.#captureDocument = null;

    const capture = new HistoryCapture(
      () => this.#finishCapture(capture),
      () => this.#discardCapture(capture),
    );
    this.#capture = capture;
    return capture;
  }

  /** Reverses the latest current-context action, falling back to document history. */
  async undo(): Promise<boolean> {
    if (this.#capture) throw new Error("cannot undo while an editor history capture is open");

    const item = this.#undoItems.pop();
    if (!item) return this.#undoDocument();

    let documentReplayed = false;
    try {
      if (item.document !== null) {
        const entryId = await this.#resolveEntryId(item.document);
        if (!entryId || !(await this.#edits?.undo(entryId))) {
          this.reset();
          return false;
        }
        documentReplayed = true;
      }

      this.#applyEditorDiff(item.editor, true);
      pushBounded(this.#redoItems, item);
      return true;
    } catch (error) {
      if (documentReplayed) {
        this.reset();
      } else {
        this.#undoItems.push(item);
      }
      throw error;
    }
  }

  /** Reapplies the latest current-context action, falling back to document history. */
  async redo(): Promise<boolean> {
    if (this.#capture) throw new Error("cannot redo while an editor history capture is open");

    const item = this.#redoItems.pop();
    if (!item) return this.#redoDocument();

    let documentReplayed = false;
    try {
      if (item.document !== null) {
        const entryId = await this.#resolveEntryId(item.document);
        if (!entryId || !(await this.#edits?.redo(entryId))) {
          this.reset();
          return false;
        }
        documentReplayed = true;
      }

      this.#applyEditorDiff(item.editor, false);
      pushBounded(this.#undoItems, item);
      return true;
    } catch (error) {
      if (documentReplayed) {
        this.reset();
      } else {
        this.#redoItems.push(item);
      }
      throw error;
    }
  }

  /** Drops session history and clears selection at an editor-context boundary. */
  reset(): void {
    if (this.#capture) this.#capture.discard();

    this.#undoItems.length = 0;
    this.#redoItems.length = 0;
    this.#captureSelection = [];
    this.#captureDocument = null;
    this.#replaceSelection([]);
  }

  /** Permanently removes subscriptions without changing selection or document state. */
  dispose(): void {
    this.#unsubscribeSelection();
    if (this.#unsubscribeEdits) this.#unsubscribeEdits();
    this.#capture = null;
    this.#undoItems.length = 0;
    this.#redoItems.length = 0;
  }

  #finishCapture(capture: HistoryCapture): void {
    if (this.#capture !== capture) return;

    const editor = editorDiff(this.#captureSelection, this.#selection.ids);
    const document = this.#captureDocument;
    this.#capture = null;
    this.#captureSelection = [];
    this.#captureDocument = null;
    if (!editor && document === null) return;

    this.#push({ document, editor });
  }

  #discardCapture(capture: HistoryCapture): void {
    if (this.#capture !== capture) return;

    const selection = this.#captureSelection;
    const document = this.#captureDocument;
    this.#capture = null;
    this.#captureSelection = [];
    this.#captureDocument = null;

    if (document !== null) {
      this.#push({ document, editor: editorDiff(selection, this.#selection.ids) });
      return;
    }

    this.#replaceSelection(selection);
  }

  #selectionChanged(before: readonly SelectableId[], after: readonly SelectableId[]): void {
    if (this.#applying || this.#capture) return;

    const editor = editorDiff(before, after);
    if (editor) this.#push({ document: null, editor });
  }

  #documentAccepted(editId: PendingEditId): void {
    if (this.#capture) {
      if (this.#captureDocument !== null && this.#captureDocument !== editId) {
        throw new Error("one editor history capture cannot contain multiple document entries");
      }

      this.#captureDocument = editId;
      return;
    }

    this.#push({ document: editId, editor: null });
  }

  #push(item: HistoryItem): void {
    this.#redoItems.length = 0;
    pushBounded(this.#undoItems, item);

    if (item.document !== null || !this.#edits?.hasRedo) return;

    void this.#discardDocumentRedo();
  }

  async #discardDocumentRedo(): Promise<void> {
    if (!this.#edits) return;

    try {
      await this.#edits.discardRedo();
    } catch (error) {
      console.error("failed to discard the document redo branch", error);
      this.reset();
    }
  }

  async #resolveEntryId(reference: PendingEditId | LedgerEntryId): Promise<LedgerEntryId | null> {
    if (typeof reference === "string") return reference;
    if (!this.#edits) return null;

    await this.#edits.settled();
    return this.#edits.ledgerEntryId(reference);
  }

  async #undoDocument(): Promise<boolean> {
    if (!this.#edits) return false;

    const applied = await this.#edits.undo();
    const entryId = applied?.ledgerEntryId;
    if (!entryId) return false;

    pushBounded(this.#redoItems, { document: entryId, editor: null });
    return true;
  }

  async #redoDocument(): Promise<boolean> {
    if (!this.#edits) return false;

    const applied = await this.#edits.redo();
    const entryId = applied?.ledgerEntryId;
    if (!entryId) return false;

    pushBounded(this.#undoItems, { document: entryId, editor: null });
    return true;
  }

  #applyEditorDiff(editor: EditorDiff | null, reverse: boolean): void {
    const diff = editor?.selection;
    if (!diff) return;

    const removed = reverse ? diff.inserted : diff.removed;
    const inserted = reverse ? diff.removed : diff.inserted;
    const current = this.#selection.ids;
    assertSequence(current, diff.start, removed);

    const next = [...current];
    next.splice(diff.start, removed.length, ...inserted);
    this.#replaceSelection(next);
  }

  #replaceSelection(ids: readonly SelectableId[]): void {
    this.#applying = true;
    try {
      this.#selection.select(ids);
    } finally {
      this.#applying = false;
    }
  }
}

function editorDiff(
  before: readonly SelectableId[],
  after: readonly SelectableId[],
): EditorDiff | null {
  const selection = sequenceDiff(before, after);
  return selection ? { selection } : null;
}

function assertSequence<T>(items: readonly T[], start: number, expected: readonly T[]): void {
  for (let index = 0; index < expected.length; index++) {
    if (items[start + index] !== expected[index]) {
      throw new Error("editor history selection no longer matches its recorded diff");
    }
  }
}

function pushBounded<T>(items: T[], item: T): void {
  items.push(item);
  if (items.length > MAX_HISTORY_ITEMS) items.shift();
}
