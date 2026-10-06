import { computed, type Signal } from "../signals";
import type { NodeId } from "@shift/types";
import type { ShiftStore } from "../store/ShiftStore";
import type { ShiftEditorRecord } from "../../types/records";
import {
  currentTextEditingId,
  type TextCaret,
  type TextEditingRecord,
  type TextEditResult,
} from "../../types/text";
import { Caret, type TextItem } from "./layout";
import {
  caretForCluster,
  clusterForCaret,
  computeSelectionRects,
  deleteText,
  selectionRange,
  spliceText,
  wordCluster,
} from "./edit";
import type { Editor } from "../editor/Editor";

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
    const items = node ? (this.#editor.text.run(node.runId)?.items ?? []) : [];
    const exists = (candidate: TextCaret) =>
      candidate === null || items.some((item) => item.id === candidate);
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

  get selectedItems(): readonly TextItem[] {
    const state = this.state;
    const items = this.#items();
    if (!state || !items) return [];
    const { start, end } = selectionRange(items, state.anchor, state.focus);
    return items.slice(start, end);
  }

  get selectionRects(): ReturnType<typeof computeSelectionRects> {
    const state = this.state;
    const node = this.#editor.scene.nodeOfKind(state?.nodeId ?? null, "textRun");
    if (!node || !state) return [];
    const run = this.#editor.text.run(node.runId);
    const layout = this.#editor.text.layoutCell(node.runId).peek();
    if (!run || !layout) return [];
    return computeSelectionRects(layout, selectionRange(run.items, state.anchor, state.focus));
  }

  insert(items: readonly TextItem[]): void {
    if (items.length === 0) return;
    this.#edit("Insert text", (current, anchor, focus) =>
      spliceText(current, anchor, focus, items),
    );
  }

  insertText(text: string): void {
    this.insert(this.#editor.text.itemsFromText(text));
  }
  deleteBackward(): void {
    this.#edit("Delete text", (items, anchor, focus) => deleteText(items, anchor, focus, -1));
  }
  deleteForward(): void {
    this.#edit("Delete text", (items, anchor, focus) => deleteText(items, anchor, focus, 1));
  }

  move(direction: -1 | 1, granularity: "character" | "word" | "line", extend = false): void {
    const state = this.state;
    const items = this.#items();
    if (!state || !items) return;
    const cluster = clusterForCaret(items, state.focus);
    let target = cluster;
    switch (granularity) {
      case "character":
        target = cluster + direction;
        break;
      case "word":
        target = wordCluster(items, cluster, direction);
        break;
      case "line": {
        const node = this.#editor.scene.nodeOfKind(state.nodeId, "textRun");
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
    const state = this.state;
    const node = this.#editor.scene.nodeOfKind(state?.nodeId ?? null, "textRun");
    const items = this.#items();
    if (!state || !node || !items) return;
    const layout = this.#editor.text.layoutCell(node.runId).peek();
    if (!layout) return;
    const caret = Caret.atCluster(layout, clusterForCaret(items, state.focus));
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
    const items = this.#items();
    if (!items) return;
    this.#place(items.length, true, "Select text", null);
  }

  #place(cluster: number, extend: boolean, label?: string, anchor?: TextCaret): void {
    const state = this.state;
    const items = this.#items();
    if (!state || !items) return;
    const caret = caretForCluster(items, cluster);
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

  #items(): readonly TextItem[] | null {
    const node = this.#editor.scene.nodeOfKind(this.state?.nodeId ?? null, "textRun");
    return node ? (this.#editor.text.run(node.runId)?.items ?? null) : null;
  }

  #edit(
    label: string,
    edit: (
      items: readonly TextItem[],
      anchor: TextCaret,
      focus: TextCaret,
    ) => TextEditResult | null,
  ): void {
    const state = this.state;
    const node = this.#editor.scene.nodeOfKind(state?.nodeId ?? null, "textRun");
    const run = node && this.#editor.text.run(node.runId);
    if (!state || !run) return;
    const result = edit(run.items, state.anchor, state.focus);
    if (!result) return;
    const write = () => {
      this.#editor.text.setItems(run.id, result.items);
      this.#store.put({ ...state, anchor: result.anchor, focus: result.focus });
    };
    this.#editor.history.captureOrJoin(label, write);
    this.#goalX = null;
  }
}
