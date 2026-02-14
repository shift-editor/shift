/**
 * Glyph render pass -- draws the glyph's contour outlines and optional filled preview.
 *
 * Operates in UPM space. The caller is responsible for applying viewport transforms
 * and setting stroke/fill styles before invoking these functions.
 */

import type { IRenderer } from "@/types/graphics";
import type { Glyph } from "@shift/types";
import { buildContourPath } from "../render";

type RenderableContour = Parameters<typeof buildContourPath>[1];

function* iterateRenderableContours(glyph: Glyph): Iterable<RenderableContour> {
  for (const contour of glyph.contours) {
    yield contour;
  }
  for (const contour of glyph.compositeContours ?? []) {
    yield contour;
  }
}

/**
 * Strokes every contour of the glyph.
 * Returns `true` if at least one contour is closed, which signals
 * that filled preview mode is viable.
 */
export function renderGlyphOutline(ctx: IRenderer, glyph: Glyph): boolean {
  let hasClosed = false;

  ctx.beginPath();
  for (const contour of iterateRenderableContours(glyph)) {
    const isClosed = buildContourPath(ctx, contour);
    if (isClosed) hasClosed = true;
  }
  ctx.stroke();

  return hasClosed;
}

/** Fills every contour with solid black. Used for preview mode rendering. */
export function renderGlyphFilled(ctx: IRenderer, glyph: Glyph): void {
  ctx.fillStyle = "black";
  ctx.beginPath();
  for (const contour of iterateRenderableContours(glyph)) {
    buildContourPath(ctx, contour);
  }
  ctx.fill();
}
