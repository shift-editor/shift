import { displayAdvance } from "@/lib/utils/unicode";
import type { GlyphCell, PositionedRun, SegmentedRun } from "./types";
import { Font } from "@/lib/model/Font";

/**
 * No-shape positioner — literal LTR advance walk, `cluster = clusterStart + i`.
 * Permanent product mode for editing scripts where the user wants source-order
 * glyph display without joining/contextual substitution (e.g. Arabic
 * side-by-side editing).
 *
 *
 */
export class Positioner {
  position(run: SegmentedRun, font: Font): PositionedRun {
    let totalAdvance = 0;

    const glyphs = run.glyphs.map((g, idx) => {
      const glyph = font.glyph(g.glyphName);
      const xAdvance = resolveAdvance(g, font);
      totalAdvance += xAdvance;

      return {
        glyphName: glyph?.name ?? g.glyphName,
        xAdvance,
        yAdvance: 0,
        xOffset: 0,
        yOffset: 0,
        cluster: run.clusterStart + idx,
        bounds: glyph?.bounds ?? null,
      };
    });

    return { ...run, glyphs, advance: totalAdvance };
  }
}

/** Resolve a glyph cell to its display advance (handles invisibles, fallbacks). */
export function resolveAdvance(cell: GlyphCell, font: Font): number {
  const raw = font.glyph(cell.glyphName)?.advance ?? 0;
  return displayAdvance(raw, cell.glyphName, cell.codepoint);
}
