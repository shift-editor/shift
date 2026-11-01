import type { TextItem } from "./layout";
import type { TextCaret, TextSelectionRange } from "../../types/text";

/**
 * A run's items with a selection, edited by value.
 *
 * @remarks
 * Carets are durable item ids: a caret sits after an item, or at the start of
 * the run when null, so it follows its item through edits elsewhere. A
 * cluster is a caret's index in the current items, from 0 to `items.length`.
 * Edits return a new buffer.
 */
export class TextBuffer {
  readonly items: readonly TextItem[];
  readonly anchor: TextCaret;
  readonly focus: TextCaret;

  /** @param anchor - Selection anchor; defaults to `focus`, a collapsed caret. */
  constructor(items: readonly TextItem[], focus: TextCaret = null, anchor: TextCaret = focus) {
    this.items = items;
    this.anchor = anchor;
    this.focus = focus;
  }

  /** The selected clusters, ordered whichever way the selection was made. */
  get selection(): TextSelectionRange {
    const anchor = this.clusterOf(this.anchor);
    const focus = this.focusCluster;
    return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
  }

  get focusCluster(): number {
    return this.clusterOf(this.focus);
  }

  get selectedItems(): readonly TextItem[] {
    const { start, end } = this.selection;
    return this.items.slice(start, end);
  }

  /** Returns a caret's cluster; a caret after an item that is gone resolves to the start. */
  clusterOf(caret: TextCaret): number {
    if (caret === null) return 0;
    const index = this.items.findIndex((item) => item.id === caret);
    return index < 0 ? 0 : index + 1;
  }

  /** Returns the caret at a cluster, clamped to the items. */
  caretAt(cluster: number): TextCaret {
    return this.items[Math.max(0, Math.min(this.items.length, cluster)) - 1]?.id ?? null;
  }

  /** Replaces the selection with `insert` and collapses the caret after it. */
  splice(insert: readonly TextItem[]): TextBuffer {
    const { start, end } = this.selection;
    const items = [...this.items.slice(0, start), ...insert, ...this.items.slice(end)];
    return collapsed(items, start + insert.length);
  }

  /**
   * Deletes the selection, or one step from a collapsed caret.
   *
   * @remarks
   * Backward removes one code point, so a combining mark goes before its base;
   * forward removes a whole grapheme cluster, up to the boundary `graphemeEnd`
   * gives after a cluster (the layout's, from Rust).
   *
   * @param graphemeEnd - defaults to one item on, for text not laid out.
   * @returns null when there is nothing to delete.
   */
  delete(
    direction: -1 | 1,
    graphemeEnd: (cluster: number) => number = (cluster) => cluster + 1,
  ): TextBuffer | null {
    let { start, end } = this.selection;
    if (start === end) {
      if (direction === -1) start = Math.max(0, start - 1);
      else end = graphemeEnd(end);
    }
    if (start === end) return null;
    return collapsed([...this.items.slice(0, start), ...this.items.slice(end)], start);
  }
}

function collapsed(items: readonly TextItem[], cluster: number): TextBuffer {
  const caret = items[cluster - 1]?.id ?? null;
  return new TextBuffer(items, caret);
}
