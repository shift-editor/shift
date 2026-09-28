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

export function deleteText(
  items: readonly TextItem[],
  anchor: TextCaret,
  focus: TextCaret,
  direction: -1 | 1,
): TextEditResult | null {
  let { start, end } = selectionRange(items, anchor, focus);
  if (start === end) {
    if (direction === -1) start = Math.max(0, start - 1);
    else end = Math.min(items.length, end + 1);
  }
  if (start === end) return null;
  const next = [...items.slice(0, start), ...items.slice(end)];
  const caret = caretForCluster(next, start);
  return { items: next, anchor: caret, focus: caret };
}

export function wordCluster(
  items: readonly TextItem[],
  cluster: number,
  direction: -1 | 1,
): number {
  let pos = cluster;
  const whitespace = (item: TextItem) =>
    item.kind === "linebreak" ||
    (item.kind === "glyph" && (item.codepoint === 32 || item.codepoint === 9));
  const punctuation = (item: TextItem) =>
    item.kind === "glyph" &&
    item.codepoint !== null &&
    ((item.codepoint >= 0x21 && item.codepoint <= 0x2f) ||
      (item.codepoint >= 0x3a && item.codepoint <= 0x40) ||
      (item.codepoint >= 0x5b && item.codepoint <= 0x60) ||
      (item.codepoint >= 0x7b && item.codepoint <= 0x7e));
  if (direction === -1) {
    while (pos > 0 && whitespace(items[pos - 1]!)) pos--;
    while (pos > 0 && !whitespace(items[pos - 1]!) && !punctuation(items[pos - 1]!)) pos--;
  } else {
    while (pos < items.length && !whitespace(items[pos]!) && !punctuation(items[pos]!)) pos++;
  }
  return pos;
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
