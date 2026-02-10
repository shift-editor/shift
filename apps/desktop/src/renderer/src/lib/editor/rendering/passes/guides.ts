/**
 * Guide render pass -- draws horizontal metric lines (ascender, cap height,
 * x-height, baseline, descender) and vertical sidebearing lines (origin, x-advance).
 *
 * Operates in UPM space. The caller should set guide stroke styles before invoking
 * {@link renderGuides}.
 */

import type { IRenderer } from "@/types/graphics";
import type { Glyph, FontMetrics } from "@shift/types";

/** Horizontal and vertical guide positions derived from font metrics and glyph advance width. */
export interface Guides {
  xAdvance: number;
  ascender: { y: number };
  capHeight: { y: number };
  xHeight: { y: number };
  baseline: { y: number };
  descender: { y: number };
}

/** Builds guide positions from the active glyph's advance width and the font's vertical metrics. */
export function getGuides(glyph: Glyph, metrics: FontMetrics): Guides {
  return {
    ascender: { y: metrics.ascender },
    capHeight: { y: metrics.capHeight ?? 0 },
    xHeight: { y: metrics.xHeight ?? 0 },
    baseline: { y: 0 },
    descender: { y: metrics.descender },
    xAdvance: glyph.xAdvance,
  };
}

/** Strokes horizontal metric lines and vertical sidebearing lines for the given guides. */
export function renderGuides(ctx: IRenderer, guides: Guides): void {
  ctx.beginPath();

  for (const y of [
    guides.ascender.y,
    guides.capHeight.y,
    guides.xHeight.y,
    guides.baseline.y,
    guides.descender.y,
  ]) {
    ctx.moveTo(0, y);
    ctx.lineTo(guides.xAdvance, y);
  }

  ctx.moveTo(0, guides.descender.y);
  ctx.lineTo(0, guides.ascender.y);
  ctx.moveTo(guides.xAdvance, guides.descender.y);
  ctx.lineTo(guides.xAdvance, guides.ascender.y);

  ctx.stroke();
}
