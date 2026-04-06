/**
 * Glyph render pass -- draws the glyph's contour outlines and optional filled preview.
 *
 * Operates in UPM space. The caller is responsible for applying viewport transforms
 * and setting stroke/fill styles before invoking these functions.
 */

import type { IRenderer } from "@/types/graphics";
import type { Glyph } from "@shift/types";
import { iterateRenderableContours } from "@shift/font";
import { getCachedContourPath } from "../render";
import { Bounds } from "@shift/geo";

type VisibleSceneBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

/**
 * Strokes every contour of the glyph.
 * Returns `true` if at least one contour is closed, which signals
 * that filled preview mode is viable.
 */
export function renderGlyphOutline(
  ctx: IRenderer,
  glyph: Glyph,
  visibleSceneBounds?: VisibleSceneBounds,
  drawOffset?: { x: number; y: number },
): boolean {
  let hasClosed = false;

  for (const contour of iterateRenderableContours(glyph)) {
    const { path, isClosed, bounds } = getCachedContourPath(contour);
    if (isClosed) hasClosed = true;
    if (
      visibleSceneBounds &&
      drawOffset &&
      bounds &&
      !Bounds.overlaps(offsetBounds(bounds, drawOffset), boundsFromSceneRect(visibleSceneBounds))
    ) {
      continue;
    }
    ctx.strokePath(path);
  }

  return hasClosed;
}

/** Fills every contour with solid black. Used for preview mode rendering. */
export function renderGlyphFilled(
  ctx: IRenderer,
  glyph: Glyph,
  visibleSceneBounds?: VisibleSceneBounds,
  drawOffset?: { x: number; y: number },
): void {
  ctx.fillStyle = "black";
  const path = new Path2D();
  for (const contour of iterateRenderableContours(glyph)) {
    const { path: contourPath, bounds } = getCachedContourPath(contour);
    if (
      visibleSceneBounds &&
      drawOffset &&
      bounds &&
      !Bounds.overlaps(offsetBounds(bounds, drawOffset), boundsFromSceneRect(visibleSceneBounds))
    ) {
      continue;
    }
    path.addPath(contourPath);
  }
  ctx.fillPath(path);
}

function offsetBounds(bounds: Bounds, offset: { x: number; y: number }): Bounds {
  return Bounds.create(
    { x: bounds.min.x + offset.x, y: bounds.min.y + offset.y },
    { x: bounds.max.x + offset.x, y: bounds.max.y + offset.y },
  );
}

function boundsFromSceneRect(rect: VisibleSceneBounds): Bounds {
  return Bounds.create({ x: rect.minX, y: rect.minY }, { x: rect.maxX, y: rect.maxY });
}
