import type { TextItem } from "./layout";
import { graphemes, segmentItems, wordSegments } from "./layout/segmentation";
import type { TextCaret, TextEditResult, TextSelectionRange } from "../../types/text";

/** Resolves a durable after-item caret against the current item order. */
export function clusterForCaret(items: readonly TextItem[], caret: TextCaret): number {
  if (caret === null) return 0;
  const index = items.findIndex((item) => item.id === caret);
  return index < 0 ? 0 : index + 1;
}

export function caretForCluster(items: readonly TextItem[], cluster: number): TextCaret {
  return items[Math.max(0, Math.min(items.length, cluster)) - 1]?.id ?? null;
}

export function selectionRange(
  items: readonly TextItem[],
  anchor: TextCaret,
  focus: TextCaret,
): TextSelectionRange {
  const a = clusterForCaret(items, anchor);
  const f = clusterForCaret(items, focus);
  return { start: Math.min(a, f), end: Math.max(a, f) };
}

/** Replaces the selected item interval and collapses both carets after the insertion. */
export function spliceText(
  items: readonly TextItem[],
  anchor: TextCaret,
  focus: TextCaret,
  insert: readonly TextItem[],
): TextEditResult {
  const { start, end } = selectionRange(items, anchor, focus);
  const next = [...items.slice(0, start), ...insert, ...items.slice(end)];
  const caret = caretForCluster(next, start + insert.length);
  return { items: next, anchor: caret, focus: caret };
}

/**
 * Deletes the selection, or one step from a collapsed caret.
 *
 * @remarks
 * Backward removes one code point, so a combining mark goes before its base;
 * forward removes a whole grapheme cluster.
 */
export function deleteText(
  items: readonly TextItem[],
  anchor: TextCaret,
  focus: TextCaret,
  direction: -1 | 1,
): TextEditResult | null {
  let { start, end } = selectionRange(items, anchor, focus);
  if (start === end) {
    if (direction === -1) start = Math.max(0, start - 1);
    else end = graphemeCluster(items, end, 1);
  }
  if (start === end) return null;
  const next = [...items.slice(0, start), ...items.slice(end)];
  const caret = caretForCluster(next, start);
  return { items: next, anchor: caret, focus: caret };
}

/**
 * Returns the next caret cluster one user-perceived character away.
 *
 * @remarks
 * Steps over a whole grapheme cluster, so a base and its combining marks, or
 * an emoji sequence, move as one.
 */
export function graphemeCluster(
  items: readonly TextItem[],
  cluster: number,
  direction: -1 | 1,
): number {
  const segments = segmentItems(items, graphemes);
  if (direction === 1) return segments.find((segment) => segment.end > cluster)?.end ?? cluster;
  return segments.findLast((segment) => segment.start < cluster)?.start ?? cluster;
}

/** Returns the end of the next word, or the start of the previous one. */
export function wordCluster(
  items: readonly TextItem[],
  cluster: number,
  direction: -1 | 1,
): number {
  const segments = wordSegments(items);
  if (direction === 1) {
    return segments.find((segment) => segment.end > cluster)?.end ?? items.length;
  }
  return segments.findLast((segment) => segment.start < cluster)?.start ?? 0;
}
