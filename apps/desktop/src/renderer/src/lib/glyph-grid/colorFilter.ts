import type { MarkColor } from "@shift/types";
import type { MarkColorFilter } from "./GlyphGridView";
import { markColorKey, UNTAGGED, type MarkColorKey } from "./markColor";

/** A glyph as the colour filter reads it. */
export interface TaggedGlyph {
  readonly markColor: MarkColor | null;
}

/** One colour the grid can be filtered to, and how many glyphs have it. */
export interface MarkColorCount {
  readonly key: MarkColorKey;
  /** null for glyphs with no colour. */
  readonly color: MarkColor | null;
  readonly count: number;
}

/** The glyphs a filter shows, in the order given; an empty filter shows them all. */
export function filterByColor<T extends TaggedGlyph>(
  glyphs: readonly T[],
  filter: MarkColorFilter,
): readonly T[] {
  if (filter.size === 0) return glyphs;

  return glyphs.filter((glyph) => filter.has(markColorKey(glyph.markColor)));
}

/**
 * The colours a filter can offer for `glyphs`: each colour in use, in the
 * order first met, then untagged, then any colour still filtered to that no
 * glyph has, so it can be switched off. Empty when no glyph is tagged and
 * nothing is filtered.
 */
export function colorsInUse(
  glyphs: readonly TaggedGlyph[],
  filter: MarkColorFilter,
): readonly MarkColorCount[] {
  const counts = new Map<MarkColorKey, MarkColorCount>();
  for (const { markColor } of glyphs) {
    const key = markColorKey(markColor);
    const counted = counts.get(key);
    counts.set(key, { key, color: markColor, count: (counted?.count ?? 0) + 1 });
  }
  for (const [key, color] of filter) {
    if (!counts.has(key)) counts.set(key, { key, color, count: 0 });
  }

  const untagged = counts.get(UNTAGGED);
  const tagged = counts
    .values()
    .filter(({ key }) => key !== UNTAGGED)
    .toArray();
  if (tagged.length === 0) return [];
  return untagged ? [...tagged, untagged] : tagged;
}
