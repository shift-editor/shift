import { displayAdvance, isNonSpacingGlyph } from "@/lib/utils/unicode";
import type { GlyphTextItem, PositionedRun, SegmentedRun } from "./types";
import type { Font } from "@/lib/model/Font";
import type { GlyphView } from "@/lib/model/Glyph";
import type { Signal } from "@/lib/signals/signal";
import type { AxisLocation } from "@/types/variation";
import type { Bounds, Point2D } from "@shift/geo";
import type { GlyphRecord, Source } from "@shift/types";

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
      const record = font.recordForName(g.glyphName);
      const view = record ? font.glyphView(record.id, designLocation) : null;
      let glyphName = g.glyphName;
      let bounds: Bounds | null = null;

      if (record && view) {
        glyphName = record.name;
        bounds = view.render.outline.bounds;
      }

      const xAdvance = resolveAdvance(g, view);
      const origin = { x: totalAdvance, y: 0 };
      const offset = resolveGlyphOffset(g, font, source);
      totalAdvance += xAdvance;

      glyphs.push({
        glyphId: record?.id ?? null,
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
export function resolveAdvance(item: GlyphTextItem, view: GlyphView | null): number {
  const raw = view?.xAdvance ?? 0;
  return displayAdvance(raw, item.glyphName, item.codepoint);
}

export function resolveGlyphOffset(
  item: GlyphTextItem,
  font: Font,
  source: Source | null,
): Point2D {
  if (!isNonSpacingGlyph(item.glyphName, item.codepoint)) return { x: 0, y: 0 };
  if (!source) return { x: 0, y: 0 };

  const record = recordForTextItem(item, font);
  const layer = record ? font.layer(record.id, source.id) : null;
  if (!layer) return { x: 0, y: 0 };

  const metrics = font.defaultSourceMetrics;
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

  const attachingAnchor = layer.anchors.find((anchor) => {
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

  const bounds = layer.bounds;
  if (!bounds) return { x: 0, y: 0 };

  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const centerY = (bounds.min.y + bounds.max.y) / 2;
  return {
    x: targetX - centerX,
    y: (metrics.ascender + metrics.descender) / 2 - centerY,
  };
}

function recordForTextItem(item: GlyphTextItem, font: Font): GlyphRecord | null {
  return font.recordForName(item.glyphName);
}
