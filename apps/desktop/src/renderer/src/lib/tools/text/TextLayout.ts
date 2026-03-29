import type { Point2D, FontMetrics, Rect2D } from "@shift/types";
import type { ToolContext } from "../core/ToolContext";
import type { LayoutGlyph } from "./types";

export function layoutText(
  text: string,
  editor: ToolContext,
  previousLayout?: LayoutGlyph[],
): LayoutGlyph[] {
  const prevByUnicode = new Map<number, LayoutGlyph>();
  if (previousLayout) {
    for (const g of previousLayout) {
      if (!prevByUnicode.has(g.unicode)) {
        prevByUnicode.set(g.unicode, g);
      }
    }
  }

  const layout: LayoutGlyph[] = [];
  const baseGlyph = editor.getGlyph();
  let xOffset = baseGlyph?.xAdvance ?? 0;
  const fallbackAdvance = editor.getFontMetrics().unitsPerEm / 2;

  for (const char of text) {
    const unicode = char.codePointAt(0)!;
    const prev = prevByUnicode.get(unicode);

    const svgPath = prev ? prev.svgPath : editor.getGlyphSvgPath(unicode);
    const advance = prev ? prev.advance : (editor.getGlyphAdvance(unicode) ?? fallbackAdvance);

    layout.push({ unicode, char, svgPath, xOffset, advance });
    xOffset += advance;
  }

  return layout;
}

export function glyphBounds(glyph: LayoutGlyph, metrics: FontMetrics): Rect2D {
  const x = glyph.xOffset;
  const y = metrics.descender;
  const width = glyph.advance;
  const height = metrics.ascender - metrics.descender;
  return {
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
  };
}

export function layoutBounds(layout: LayoutGlyph[], metrics: FontMetrics): Rect2D | null {
  if (layout.length === 0) return null;

  const first = layout[0];
  const last = layout[layout.length - 1];

  const x = first.xOffset;
  const y = metrics.descender;
  const width = last.xOffset + last.advance - x;
  const height = metrics.ascender - metrics.descender;
  return {
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
  };
}

export function hitTestLayoutAt(
  layout: LayoutGlyph[],
  metrics: FontMetrics,
  pos: Point2D,
): number | null {
  if (layout.length === 0) return null;

  const bounds = layoutBounds(layout, metrics);
  if (!bounds) return null;

  if (
    pos.y < bounds.y ||
    pos.y > bounds.y + bounds.height ||
    pos.x < bounds.x ||
    pos.x > bounds.x + bounds.width
  ) {
    return null;
  }

  for (let i = 0; i < layout.length; i++) {
    const glyph = layout[i];
    if (pos.x >= glyph.xOffset && pos.x < glyph.xOffset + glyph.advance) {
      return i;
    }
  }

  return null;
}

export function cursorXFromIndex(layout: LayoutGlyph[], index: number): number {
  if (layout.length === 0) return 0;
  if (index >= layout.length) {
    const last = layout[layout.length - 1];
    return last.xOffset + last.advance;
  }
  return layout[index].xOffset;
}
