import type { TextItem } from "./layout";
import type { TextCaret, TextSelectionRange } from "../../types/text";

/** A segment of the items, in item indexes. */
interface ItemSegment {
  readonly start: number;
  readonly end: number;
  readonly isWordLike: boolean;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const words = new Intl.Segmenter(undefined, { granularity: "word" });

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
  #graphemes: readonly ItemSegment[] | null = null;
  #words: readonly ItemSegment[] | null = null;

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
   * forward removes a whole grapheme cluster.
   *
   * @returns null when there is nothing to delete.
   */
  delete(direction: -1 | 1): TextBuffer | null {
    let { start, end } = this.selection;
    if (start === end) {
      if (direction === -1) start = Math.max(0, start - 1);
      else end = this.graphemeStep(end, 1);
    }
    if (start === end) return null;
    return collapsed([...this.items.slice(0, start), ...this.items.slice(end)], start);
  }

  /**
   * Returns the cluster one user-perceived character away.
   *
   * @remarks
   * Steps over a whole grapheme cluster, so a base and its combining marks, or
   * an emoji sequence, move as one.
   */
  graphemeStep(cluster: number, direction: -1 | 1): number {
    this.#graphemes ??= segmentItems(this.items, graphemes);
    if (direction === 1) {
      return this.#graphemes.find((segment) => segment.end > cluster)?.end ?? cluster;
    }
    return this.#graphemes.findLast((segment) => segment.start < cluster)?.start ?? cluster;
  }

  /** Returns the end of the next word, or the start of the previous one. */
  wordStep(cluster: number, direction: -1 | 1): number {
    this.#words ??= segmentItems(this.items, words).filter((segment) => segment.isWordLike);
    if (direction === 1) {
      return this.#words.find((segment) => segment.end > cluster)?.end ?? this.items.length;
    }
    return this.#words.findLast((segment) => segment.start < cluster)?.start ?? 0;
  }
}

function collapsed(items: readonly TextItem[], cluster: number): TextBuffer {
  const caret = items[cluster - 1]?.id ?? null;
  return new TextBuffer(items, caret);
}

/**
 * Segments items with a Unicode segmenter.
 *
 * @remarks
 * Each item reads as one code point: a line break as `\n` and a picked glyph
 * as U+FFFC, the object replacement character, so it stands alone like an
 * inline object.
 */
function segmentItems(items: readonly TextItem[], segmenter: Intl.Segmenter): ItemSegment[] {
  let text = "";
  const itemAt = new Map<number, number>();
  items.forEach((item, index) => {
    itemAt.set(text.length, index);
    if (item.kind === "character") text += String.fromCodePoint(item.codepoint);
    else text += item.kind === "linebreak" ? "\n" : "￼";
  });
  itemAt.set(text.length, items.length);

  return [...segmenter.segment(text)].map((segment) => ({
    start: itemAt.get(segment.index)!,
    end: itemAt.get(segment.index + segment.segment.length)!,
    isWordLike: segment.isWordLike ?? false,
  }));
}
