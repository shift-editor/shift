/**
 * Glyph render pass — draws the glyph's contour outlines and optional filled preview.
 *
 * Reads pre-computed paths from the reactive Glyph. The Glyph class owns all
 * path computation; this pass just strokes/fills.
 */

import type { IRenderer } from "@/types/graphics";
import type { Glyph } from "@/lib/model/glyph";

/**
 * Strokes the glyph's complete path (all contours + composites).
 * Returns `true` if at least one contour is closed (filled preview is viable).
 */
export function renderGlyphOutline(ctx: IRenderer, glyph: Glyph): boolean {
  ctx.strokePath(glyph.path);
  return glyph.contours.some((c) => c.closed);
}

/** Fills the glyph's complete path. Used for preview mode rendering. */
export function renderGlyphFilled(ctx: IRenderer, glyph: Glyph): void {
  ctx.fillStyle = "black";
  ctx.fillPath(glyph.path);
}
