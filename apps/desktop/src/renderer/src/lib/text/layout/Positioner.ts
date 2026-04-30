import { displayAdvance, isNonSpacingGlyph } from "@/lib/utils/unicode";
import type { GlyphCell, PositionedRun, SegmentedRun } from "./types";
import { Font } from "@/lib/model/Font";
import type { Point2D } from "@shift/types";

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
      const origin = { x: totalAdvance, y: 0 };
      const offset = resolveGlyphOffset(g, font);
      totalAdvance += xAdvance;

      return {
        glyphName: glyph?.name ?? g.glyphName,
        cellIds: [g.id],
        origin,
        xAdvance,
        yAdvance: 0,
        xOffset: offset.x,
        yOffset: offset.y,
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

export function resolveGlyphOffset(cell: GlyphCell, font: Font): Point2D {
  if (!isNonSpacingGlyph(cell.glyphName, cell.codepoint)) return { x: 0, y: 0 };

  const glyph = font.glyph(cell.glyphName);
  if (!glyph) return { x: 0, y: 0 };

  const metrics = font.getMetrics();
  const targetX = 300;
  const targetYForAnchorName = (anchorName: string): number => {
    switch (anchorName) {
      case "top":
        return metrics.capHeight ?? metrics.ascender;
      case "bottom":
      case "ogonek":
        return 0;
      case "center":
      default:
        return (metrics.ascender + metrics.descender) / 2;
    }
  };

  const attachingAnchor = glyph.anchors.find((anchor) => {
    const name = anchor.name ?? "";
    return name.startsWith("_") && name.length > 1;
  });

  if (attachingAnchor) {
    const targetName = attachingAnchor.name!.slice(1);
    return {
      x: targetX - attachingAnchor.x,
      y: targetYForAnchorName(targetName) - attachingAnchor.y,
    };
  }

  const bounds = glyph.bounds;
  if (!bounds) return { x: 0, y: 0 };

  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const centerY = (bounds.min.y + bounds.max.y) / 2;
  return {
    x: targetX - centerX,
    y: (metrics.ascender + metrics.descender) / 2 - centerY,
  };
}
