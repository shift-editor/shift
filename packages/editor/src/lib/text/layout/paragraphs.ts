import type { ShapedRun } from "@shift/types";
import type { Font } from "../../model/Font";
import {
  glyphIdForItem,
  type Paragraph,
  type ParagraphItem,
  type SegmentedRun,
  type TextItem,
} from "./types";

/**
 * Splits items into paragraphs on line breaks.
 *
 * @remarks
 * Shaping requests and layout both split with this, so a paragraph's shaped
 * runs and its items line up by index. A line break belongs to no paragraph
 * but consumes a cluster: the next paragraph starts one past it.
 *
 *   items:  [A, B, \n, C]   →  [{ items: [A, B], clusterStart: 0 }, { items: [C], clusterStart: 3 }]
 *   items:  [A, \n]         →  [{ items: [A], clusterStart: 0 }, { items: [], clusterStart: 2 }]
 *   items:  []              →  []
 */
export function splitParagraphs(items: readonly TextItem[]): Paragraph[] {
  if (items.length === 0) return [];
  const paragraphs: Paragraph[] = [];
  let paragraph: ParagraphItem[] = [];
  let clusterStart = 0;
  items.forEach((item, index) => {
    if (item.kind !== "linebreak") {
      paragraph.push(item);
      return;
    }
    paragraphs.push({ items: paragraph, clusterStart });
    paragraph = [];
    clusterStart = index + 1;
  });
  paragraphs.push({ items: paragraph, clusterStart });
  return paragraphs;
}

/**
 * Returns a paragraph's shaped runs as layout runs, with clusters made run-relative.
 *
 * @remarks
 * Runs keep the order shaping gives them: screen order, one per script and
 * bidi level, already reordered by level in shift-shape.
 */
export function shapedRuns(paragraph: Paragraph, runs: readonly ShapedRun[]): SegmentedRun[] {
  return runs.map((run) => ({
    items: paragraph.items.slice(run.start, run.end),
    direction: run.direction,
    script: run.script,
    clusterStart: paragraph.clusterStart + run.start,
    shaped: run.glyphs.map((glyph) => ({
      ...glyph,
      cluster: glyph.cluster - run.start,
    })),
  }));
}

/** Returns a paragraph as one left-to-right run of one glyph per item, unshaped. */
export function literalRun(paragraph: Paragraph, font: Font): SegmentedRun {
  return {
    items: paragraph.items,
    direction: "ltr",
    clusterStart: paragraph.clusterStart,
    shaped: paragraph.items.map((item, cluster) => ({
      glyphId: glyphIdForItem(item, font) ?? undefined,
      cluster,
      xAdvance: 0,
      yAdvance: 0,
      xOffset: 0,
      yOffset: 0,
      isMark: false,
    })),
  };
}
