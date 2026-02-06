import type { IRenderer } from "@/types/graphics";
import type { Glyph, FontMetrics } from "@shift/types";

export interface Guides {
  xAdvance: number;
  ascender: { y: number };
  capHeight: { y: number };
  xHeight: { y: number };
  baseline: { y: number };
  descender: { y: number };
}

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
