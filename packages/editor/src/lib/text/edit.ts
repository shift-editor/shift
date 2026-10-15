import type { TextItem, TextLayout } from "./layout";
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

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const words = new Intl.Segmenter(undefined, { granularity: "word" });

/** A segment of the items, in item indexes. */
interface ItemSegment {
  readonly start: number;
  readonly end: number;
  readonly isWordLike: boolean;
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
    else text += item.kind === "linebreak" ? "\n" : "\uFFFC";
  });
  itemAt.set(text.length, items.length);

  return [...segmenter.segment(text)].map((segment) => ({
    start: itemAt.get(segment.index)!,
    end: itemAt.get(segment.index + segment.segment.length)!,
    isWordLike: segment.isWordLike ?? false,
  }));
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
  const segments = segmentItems(items, words).filter((segment) => segment.isWordLike);
  if (direction === 1) {
    return segments.find((segment) => segment.end > cluster)?.end ?? items.length;
  }
  return segments.findLast((segment) => segment.start < cluster)?.start ?? 0;
}

/** Returns advance-based selection rectangles; structural linebreaks own no fill. */
export function computeSelectionRects(
  layout: TextLayout,
  range: TextSelectionRange,
): { x: number; width: number; top: number; bottom: number }[] {
  const rects: { x: number; width: number; top: number; bottom: number }[] = [];
  for (const line of layout.lines) {
    let runBase = layout.origin.x;
    let left: number | null = null;
    let right = runBase;
    for (const run of line.runs) {
      for (const glyph of run.glyphs) {
        if (glyph.cluster < range.start || glyph.cluster >= range.end) continue;
        left ??= runBase + glyph.origin.x;
        right = runBase + glyph.origin.x + glyph.xAdvance;
      }
      runBase += run.advance;
    }
    if (left !== null)
      rects.push({
        x: left,
        width: right - left,
        top: line.y + line.ascent,
        bottom: line.y + line.descent,
      });
  }
  return rects;
}
