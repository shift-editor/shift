import type { PositionedGlyph, TextItem, TextItemId } from "./types";

/**
 * A stretch of a paragraph's glyphs a line may not break inside: a word and
 * the spaces after it.
 *
 * @remarks
 * Glyph indexes count the paragraph's glyphs in visual order across its runs.
 * Widths are pen advances (advance plus kerning) in font units, the same
 * measure `shift-layout`'s `BreakSegments` takes.
 */
export interface BreakSegment {
  /** The segment's first glyph. */
  readonly start: number;
  /** One past the segment's last glyph, spaces included. */
  readonly end: number;
  /** Width of the word, without the spaces after it. */
  readonly width: number;
  /** Width of the spaces after the word, kept inside a line and dropped where it ends. */
  readonly trailing: number;
}

/** One soft line, as a range of segments. */
export interface SegmentLine {
  readonly start: number;
  readonly end: number;
}

/**
 * How far a line may exceed the width it is offered, relative to it, and
 * still fit: the same tolerance as `shift-layout`, so the editor and the
 * layout engine break a measured width the same way.
 */
const FIT_TOLERANCE = 1e-5;

/** Returns which items are spaces a line may break after. */
export function breakableItems(items: readonly TextItem[]): ReadonlySet<TextItemId> {
  const spaces = new Set<TextItemId>();
  for (const item of items) {
    if (item.kind === "character" && isBreakingSpace(item.codepoint)) spaces.add(item.id);
  }
  return spaces;
}

/**
 * Cuts a paragraph's glyphs into break segments: each word with the spaces after it.
 *
 * @remarks
 * Spaces before the first word make a segment of zero width. A paragraph with
 * no glyphs has no segments.
 */
export function breakSegments(
  glyphs: readonly PositionedGlyph[],
  spaces: ReadonlySet<TextItemId>,
): BreakSegment[] {
  const segments: BreakSegment[] = [];
  let start = 0;
  let width = 0;
  let trailing = 0;
  let afterSpace = false;
  for (const [index, glyph] of glyphs.entries()) {
    const advance = glyph.xAdvance + glyph.xKern;
    if (isSpace(glyph, spaces)) {
      trailing += advance;
      afterSpace = true;
      continue;
    }
    // A word after spaces starts a segment: close the one before it.
    if (afterSpace) {
      segments.push({ start, end: index, width, trailing });
      start = index;
      width = 0;
      trailing = 0;
      afterSpace = false;
    }
    width += advance;
  }
  if (glyphs.length > start) segments.push({ start, end: glyphs.length, width, trailing });
  return segments;
}

/**
 * Splits each segment wider than `maxWidth` between its glyphs, so a word
 * too long for the line breaks inside rather than overflowing.
 *
 * @remarks
 * Glyphs sharing a cluster (a ligature, a base and its marks) stay together.
 * The pieces keep no space between them; the last keeps the word's spaces.
 */
export function splitWideSegments(
  segments: readonly BreakSegment[],
  glyphs: readonly PositionedGlyph[],
  spaces: ReadonlySet<TextItemId>,
  maxWidth: number,
): BreakSegment[] {
  const limit = maxWidth + Math.abs(maxWidth) * FIT_TOLERANCE;
  const split: BreakSegment[] = [];
  for (const segment of segments) {
    if (segment.width <= limit) {
      split.push(segment);
      continue;
    }

    // The word's glyphs, before the spaces that follow it.
    let wordEnd = segment.start;
    while (wordEnd < segment.end && !isSpace(glyphs[wordEnd]!, spaces)) wordEnd++;

    let start = segment.start;
    while (start < wordEnd) {
      const cluster = glyphs[start]!.cluster;
      let end = start + 1;
      let width = glyphAdvance(glyphs[start]!);
      while (end < wordEnd && glyphs[end]!.cluster === cluster) {
        width += glyphAdvance(glyphs[end]!);
        end++;
      }
      const last = end >= wordEnd;
      split.push({
        start,
        end: last ? segment.end : end,
        width,
        trailing: last ? segment.trailing : 0,
      });
      start = end;
    }
  }
  return split;
}

/**
 * Breaks segments into lines no wider than `maxWidth`, greedily.
 *
 * @remarks
 * Each line takes segments while they fit, counting the spaces between them
 * but not the spaces after the last. A segment wider than the line gets a line
 * of its own. Mirrors `BreakSegments::break_lines` in `shift-layout`.
 */
export function breakLines(segments: readonly BreakSegment[], maxWidth: number): SegmentLine[] {
  if (segments.length === 0) return [{ start: 0, end: 0 }];

  const limit = maxWidth + Math.abs(maxWidth) * FIT_TOLERANCE;
  const lines: SegmentLine[] = [];
  let start = 0;
  while (start < segments.length) {
    let width = segments[start]!.width;
    let end = start + 1;
    while (end < segments.length) {
      const candidate = width + segments[end - 1]!.trailing + segments[end]!.width;
      if (candidate > limit) break;
      width = candidate;
      end++;
    }
    lines.push({ start, end });
    start = end;
  }
  return lines;
}

function isSpace(glyph: PositionedGlyph, spaces: ReadonlySet<TextItemId>): boolean {
  return glyph.sourceItemIds.some((id) => spaces.has(id));
}

function glyphAdvance(glyph: PositionedGlyph): number {
  return glyph.xAdvance + glyph.xKern;
}

function isBreakingSpace(codepoint: number): boolean {
  return codepoint === 0x20 || codepoint === 0x09 || codepoint === 0x3000;
}
