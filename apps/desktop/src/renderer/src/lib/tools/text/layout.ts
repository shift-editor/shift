import type { Point2D, FontMetrics } from "@shift/types";
import type { Bounds } from "@shift/geo";
import type { FontContext } from "../core/ToolContext";

export interface GlyphSlot {
  unicode: number;
  x: number;
  advance: number;
  bounds: Bounds | null;
  svgPath: string | null;
}

export interface TextLayout {
  slots: GlyphSlot[];
  totalAdvance: number;
}

export function computeTextLayout(
  codepoints: number[],
  origin: Point2D,
  fontContext: FontContext,
): TextLayout {
  const slots: GlyphSlot[] = [];
  let cursor = origin.x;

  for (const unicode of codepoints) {
    const advance = fontContext.getGlyphAdvance(unicode);
    const bounds = fontContext.getGlyphBbox(unicode);
    const svgPath = fontContext.getGlyphSvgPath(unicode);
    const glyphAdvance = advance ?? 0;

    slots.push({
      unicode,
      x: cursor,
      advance: glyphAdvance,
      bounds,
      svgPath,
    });

    cursor += glyphAdvance;
  }

  return {
    slots,
    totalAdvance: cursor - origin.x,
  };
}

export function hitTestLayout(
  layout: TextLayout,
  pos: Point2D,
  metrics: FontMetrics,
): number | null {
  const { slots } = layout;
  if (slots.length === 0) return null;

  const top = metrics.ascender;
  const bottom = metrics.descender;
  if (pos.y > top || pos.y < bottom) return null;

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const midX = slot.x + slot.advance / 2;
    if (pos.x < midX) return i;
  }

  return slots.length;
}
