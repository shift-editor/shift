/**
 * Pure rendering functions for glyph visualization.
 *
 * These functions take snapshot data and render to a canvas context.
 * No state is maintained - each call renders based on the provided data.
 */

import type { IRenderer } from "@/types/graphics";
import { parseContourSegments, segmentToCurve, type SegmentContourLike } from "@shift/font";
import { Bounds, Curve, type Bounds as BoundsType } from "@shift/geo";
import { GlyphRenderCache } from "@/lib/cache/GlyphRenderCache";

export function getCachedContourPath(contour: SegmentContourLike): {
  path: Path2D;
  isClosed: boolean;
  bounds: BoundsType | null;
} {
  const cached = GlyphRenderCache.getContourPath(contour);
  if (cached) return cached;

  const path = new Path2D();
  if (contour.points.length < 2) {
    const result = { path, isClosed: false, bounds: null };
    GlyphRenderCache.setContourPath(contour, result);
    return result;
  }

  const segments = parseContourSegments(contour);
  const firstSegment = segments[0];
  if (!firstSegment) {
    const result = { path, isClosed: false, bounds: null };
    GlyphRenderCache.setContourPath(contour, result);
    return result;
  }

  const bounds = Bounds.unionAll(segments.map((segment) => Curve.bounds(segmentToCurve(segment))));

  path.moveTo(firstSegment.points.anchor1.x, firstSegment.points.anchor1.y);

  for (const segment of segments) {
    switch (segment.type) {
      case "line":
        path.lineTo(segment.points.anchor2.x, segment.points.anchor2.y);
        break;
      case "quad":
        path.quadraticCurveTo(
          segment.points.control.x,
          segment.points.control.y,
          segment.points.anchor2.x,
          segment.points.anchor2.y,
        );
        break;
      case "cubic":
        path.bezierCurveTo(
          segment.points.control1.x,
          segment.points.control1.y,
          segment.points.control2.x,
          segment.points.control2.y,
          segment.points.anchor2.x,
          segment.points.anchor2.y,
        );
        break;
    }
  }

  if (contour.closed) path.closePath();

  const result = { path, isClosed: contour.closed, bounds };
  GlyphRenderCache.setContourPath(contour, result);
  return result;
}

/**
 * Traces the contour's segments into the current path without stroking or filling.
 * Returns `true` if the contour is closed (caller can decide to fill).
 */
export function buildContourPath(ctx: IRenderer, contour: SegmentContourLike): boolean {
  if (contour.points.length < 2) return false;
  const segments = parseContourSegments(contour);
  if (segments.length === 0) return false;
  const firstSegment = segments[0];
  if (!firstSegment) return false;
  ctx.moveTo(firstSegment.points.anchor1.x, firstSegment.points.anchor1.y);

  for (const segment of segments) {
    switch (segment.type) {
      case "line":
        ctx.lineTo(segment.points.anchor2.x, segment.points.anchor2.y);
        break;
      case "quad":
        ctx.quadTo(
          segment.points.control.x,
          segment.points.control.y,
          segment.points.anchor2.x,
          segment.points.anchor2.y,
        );
        break;
      case "cubic":
        ctx.cubicTo(
          segment.points.control1.x,
          segment.points.control1.y,
          segment.points.control2.x,
          segment.points.control2.y,
          segment.points.anchor2.x,
          segment.points.anchor2.y,
        );
        break;
    }
  }

  if (contour.closed) ctx.closePath();
  return contour.closed;
}

