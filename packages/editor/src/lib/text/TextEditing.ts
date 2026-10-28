import { computed, type Signal } from "../signals";
import type { NodeId } from "@shift/types";
import type { ShiftStore } from "../store/ShiftStore";
import type { ShiftEditorRecord } from "../../types/records";
import {
  currentTextEditingId,
  type TextCaret,
  type TextEditingRecord,
  type TextSelectionRange,
} from "../../types/text";
import {
  Caret,
  characterTextItem,
  lineBreakTextItem,
  type CaretPosition,
  type SelectionRect,
  type TextItem,
} from "./layout";
import { TextBuffer } from "./TextBuffer";
import type { Editor } from "../editor/Editor";
import type { TextRunNode } from "../../types/node";

/** The caret shown in a text run node; see {@link TextEditing.caretIn}. */
export interface ShownCaret {
  /** The focus caret's cluster index in the run. */
  readonly cluster: number;
  readonly selection: TextSelectionRange;
  /** Where the caret draws, in the run's layout units. */
  readonly position: CaretPosition;
}

/** Owns the session caret for one placed text node; text content belongs to Text. */
export class TextEditing {
  readonly #store: ShiftStore<ShiftEditorRecord>;
  readonly #editor: Editor;
  readonly stateCell: Signal<TextEditingRecord | null>;
  #goalX: number | null = null;

  constructor(store: ShiftStore<ShiftEditorRecord>, editor: Editor) {
    this.#store = store;
    this.#editor = editor;
    this.stateCell = computed(
      () => {
        const record = store.cell.value.get(currentTextEditingId);
        return record?.type === "textEditing" && record.active ? record : null;
      },
      { name: "editor.textEditing" },
    );
  }

  get state(): TextEditingRecord | null {
    return this.stateCell.peek();
  }

  /**
   * Begins editing within the caller's pointer capture.
   *
   * @param caret - focus caret; null is the start of the run.
   * @param anchor - selection anchor; defaults to `caret`, a collapsed caret.
   */
  begin(nodeId: NodeId, caret: TextCaret = null, anchor: TextCaret = caret): void {
    if (!this.#editor.scene.nodeOfKind(nodeId, "textRun")) return;
    this.#store.put({
      id: currentTextEditingId,
      type: "textEditing",
      scope: "session",
      nodeId,
      anchor,
      focus: caret,
      active: true,
    });
    this.#goalX = null;
  }

  /**
   * Shows the caret and selection kept from the last visit to a run, or begins at `caret`.
   *
   * @remarks
   * Falls back to `caret` when the kept record is for another run or its
   * items no longer exist.
   */
  resume(nodeId: NodeId, caret: TextCaret): void {
    const kept = this.#store.get(currentTextEditingId);
    const node = this.#editor.scene.nodeOfKind(nodeId, "textRun");
    const exists = (candidate: TextCaret) =>
      candidate === null ||
      (node !== null && this.#editor.text.runForItem(candidate)?.id === node.runId);
    if (
      kept?.type === "textEditing" &&
      kept.nodeId === nodeId &&
      exists(kept.anchor) &&
      exists(kept.focus)
    ) {
      this.#store.put({ ...kept, active: true });
      this.#goalX = null;
      return;
    }
    this.begin(nodeId, caret);
  }

  /** Hides the caret and keeps it for {@link resume}; callers decide whether the change is history-bearing. */
  end(): void {
    const kept = this.#store.get(currentTextEditingId);
    if (kept?.type === "textEditing") this.#store.put({ ...kept, active: false });
    this.#goalX = null;
  }

  /**
   * The caret Text mode shows in a text run node, with its selection and
   * where it draws.
   *
   * @returns null when that node is not being edited or its run cannot lay out.
   */
  caretIn(nodeId: NodeId): ShownCaret | null {
    if (this.state?.nodeId !== nodeId) return null;
    const node = this.#node();
    const buffer = this.#buffer();
    const layout = node && this.#editor.text.layout(node.runId);
    if (!buffer || !layout) return null;

    const cluster = buffer.focusCluster;
    return { cluster, selection: buffer.selection, position: layout.caretAt(cluster).position() };
  }

  get selectedItems(): readonly TextItem[] {
    return this.#buffer()?.selectedItems ?? [];
  }

  get selectionRects(): readonly SelectionRect[] {
    const node = this.#node();
    const buffer = this.#buffer();
    const layout = node && this.#editor.text.layout(node.runId);
    if (!buffer || !layout) return [];
    return layout.selectionRects(buffer.selection);
  }

  insert(items: readonly TextItem[]): void {
    if (items.length === 0) return;
    this.#edit("Insert text", (buffer) => buffer.splice(items));
  }

  /** Inserts text as pasted: `/name` picks the glyph named `name`. */
  insertText(text: string): void {
    this.insert(this.#editor.text.itemsFromText(text));
  }

  /**
   * Inserts text as typed: every character literally, with each line ending
   * a line break.
   */
  typeText(text: string): void {
    this.insert(
      [...text.replaceAll("\r\n", "\n")].map((char) =>
        char === "\n" ? lineBreakTextItem() : characterTextItem(char.codePointAt(0)!),
      ),
    );
  }
  deleteBackward(): void {
    this.#edit("Delete text", (buffer) => buffer.delete(-1));
  }
  deleteForward(): void {
    this.#edit("Delete text", (buffer) => buffer.delete(1));
  }

  move(direction: -1 | 1, granularity: "character" | "word" | "line", extend = false): void {
    const buffer = this.#buffer();
    if (!buffer) return;
    const cluster = buffer.focusCluster;
    let target = cluster;
    switch (granularity) {
      case "character":
        target = buffer.graphemeStep(cluster, direction);
        break;
      case "word":
        target = buffer.wordStep(cluster, direction);
        break;
      case "line": {
        const node = this.#node();
        const line =
          node &&
          this.#editor.text
            .layoutCell(node.runId)
            .peek()
            ?.lines.find((line) => cluster >= line.clusterStart && cluster < line.clusterEnd);
        if (!line) {
          target = cluster;
          break;
        }
        target = direction === -1 ? line.clusterStart : line.clusterEnd - 1;
        break;
      }
    }
    this.#goalX = null;
    this.#place(target, extend, "Move text caret");
  }

  moveVertical(direction: -1 | 1, extend = false): void {
    const node = this.#node();
    const buffer = this.#buffer();
    const layout = node && this.#editor.text.layout(node.runId);
    if (!buffer || !layout) return;
    const caret = Caret.atCluster(layout, buffer.focusCluster);
    this.#goalX ??= caret.position().x;
    this.#place(
      (direction === -1 ? caret.previousLine(this.#goalX) : caret.nextLine(this.#goalX)).cluster,
      extend,
      "Move text caret",
    );
  }

  /** Places a caret inside an existing pointer capture. */
  placeAtCluster(cluster: number, extend = false): void {
    this.#goalX = null;
    this.#place(cluster, extend);
  }

  selectAll(): void {
    const buffer = this.#buffer();
    if (!buffer) return;
    this.#place(buffer.items.length, true, "Select text", null);
  }

  #place(cluster: number, extend: boolean, label?: string, anchor?: TextCaret): void {
    const state = this.state;
    const buffer = this.#buffer();
    if (!state || !buffer) return;
    const caret = buffer.caretAt(cluster);
    const extendedAnchor = extend ? state.anchor : caret;
    const write = () =>
      this.#store.put({
        ...state,
        anchor: anchor === undefined ? extendedAnchor : anchor,
        focus: caret,
      });
    if (label) this.#editor.history.captureOrJoin(label, write);
    else write();
  }

  #node(): TextRunNode | null {
    return this.#editor.scene.nodeOfKind(this.state?.nodeId ?? null, "textRun");
  }

  /** The edited run's items with the current selection; null when not editing. */
  #buffer(): TextBuffer | null {
    const state = this.state;
    const node = this.#node();
    if (!state || !node) return null;
    return new TextBuffer(this.#editor.text.items(node), state.focus, state.anchor);
  }

  #edit(label: string, edit: (buffer: TextBuffer) => TextBuffer | null): void {
    const state = this.state;
    const node = this.#node();
    const run = node && this.#editor.text.run(node.runId);
    if (!state || !run) return;
    const result = edit(new TextBuffer(run.items, state.focus, state.anchor));
    if (!result) return;
    const write = () => {
      this.#editor.text.setItems(run.id, result.items);
      this.#store.put({ ...state, anchor: result.anchor, focus: result.focus });
    };
    this.#editor.history.captureOrJoin(label, write);
    this.#goalX = null;
  }
}
