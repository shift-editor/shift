import type { Point2D, FontMetrics } from "@shift/types";
import type { Bounds } from "@shift/geo";
import type { Font } from "@/lib/editor/Font";

export interface GlyphSlot {
  unicode: number;
  x: number;
  advance: number;
  bounds: Bounds | null;
  svgPath: string | null;
  selected: boolean;
}

export interface TextLayout {
  slots: GlyphSlot[];
  totalAdvance: number;
}

export function computeTextLayout(codepoints: number[], origin: Point2D, font: Font): TextLayout {
  const slots: GlyphSlot[] = [];
  let x = origin.x;
  const selected = false;

  for (const unicode of codepoints) {
    const advance = font.getAdvance(unicode) ?? 0;
    const bounds = font.getBbox(unicode);
    const svgPath = font.getSvgPath(unicode);

    slots.push({
      unicode,
      x,
      advance,
      bounds,
      svgPath,
      selected,
    });

    x += advance;
  }

  return {
    slots,
    totalAdvance: x - origin.x,
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
