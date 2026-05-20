import { displayAdvance, isNonSpacingGlyph } from "@/lib/utils/unicode";
import type { GlyphTextItem, PositionedRun, SegmentedRun } from "./types";
import { Font } from "@/lib/model/Font";
import type { Signal } from "@/lib/signals/signal";
import type { AxisLocation } from "@/types/variation";
import type { Bounds, Point2D } from "@shift/geo";
import type { Source } from "@shift/types";

/**
 * No-shape positioner — literal LTR advance walk, `cluster = clusterStart + i`.
 * Permanent product mode for editing scripts where the user wants source-order
 * glyph display without joining/contextual substitution (e.g. Arabic
 * side-by-side editing).
 *
 *
 */
export class Positioner {
  position(run: SegmentedRun, font: Font, designLocation: Signal<AxisLocation>): PositionedRun {
    let totalAdvance = 0;
    const glyphs: PositionedRun["glyphs"] = [];
    const source = font.sourceAtOrDefault(designLocation.peek());

    for (const [idx, g] of run.glyphs.entries()) {
      const handle = { name: g.glyphName };
      const glyph = font.glyph(handle);
      let glyphName = g.glyphName;
      let bounds: Bounds | null = null;

      if (glyph) {
        glyphName = glyph.name;
        bounds = glyph.instance(designLocation).render.outline.bounds;
      }

      const xAdvance = resolveAdvance(g, font, source);
      const origin = { x: totalAdvance, y: 0 };
      const offset = resolveGlyphOffset(g, font, source);
      totalAdvance += xAdvance;

      glyphs.push({
        glyphName,
        sourceItemIds: [g.id],
        origin,
        xAdvance,
        yAdvance: 0,
        xOffset: offset.x,
        yOffset: offset.y,
        cluster: run.clusterStart + idx,
        bounds,
      });
    }

    return { ...run, glyphs, advance: totalAdvance };
  }
}

/** Resolve a glyph item to its display advance (handles invisibles, fallbacks). */
export function resolveAdvance(item: GlyphTextItem, font: Font, source: Source | null): number {
  const raw = source ? (font.glyphSource({ name: item.glyphName }, source)?.xAdvance ?? 0) : 0;
  return displayAdvance(raw, item.glyphName, item.codepoint);
}

export function resolveGlyphOffset(
  item: GlyphTextItem,
  font: Font,
  source: Source | null,
): Point2D {
  if (!isNonSpacingGlyph(item.glyphName, item.codepoint)) return { x: 0, y: 0 };
  if (!source) return { x: 0, y: 0 };

  const glyph = font.glyphSource({ name: item.glyphName }, source);
  if (!glyph) return { x: 0, y: 0 };

  const metrics = font.metrics;
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
