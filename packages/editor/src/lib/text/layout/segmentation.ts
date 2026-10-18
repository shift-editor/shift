import type { TextItem } from "./types";

export const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const words = new Intl.Segmenter(undefined, { granularity: "word" });

/** A segment of the items, in item indexes. */
export interface ItemSegment {
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
export function segmentItems(items: readonly TextItem[], segmenter: Intl.Segmenter): ItemSegment[] {
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

/** Returns the item indexes a caret may stand at: grapheme cluster boundaries, both ends included. */
export function graphemeBoundaries(items: readonly TextItem[]): ReadonlySet<number> {
  const boundaries = new Set([0, items.length]);
  for (const segment of segmentItems(items, graphemes)) boundaries.add(segment.start);
  return boundaries;
}

/** Returns the word-like segments of the items, such as words and numbers, not spaces or punctuation. */
export function wordSegments(items: readonly TextItem[]): ItemSegment[] {
  return segmentItems(items, words).filter((segment) => segment.isWordLike);
}
