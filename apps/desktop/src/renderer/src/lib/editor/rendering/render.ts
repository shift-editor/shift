/**
 * Pure rendering functions for glyph visualization.
 *
 * For reactive {@link GlyphContour} instances, callers should read
 * `contour.path` / `contour.bounds` directly (the computed IS the cache).
 *
 * {@link getCachedContourPath} is kept only for plain contour objects
 * (composite contours, render-only contours) that don't have computed paths.
 */

import type { IRenderer } from "@/types/graphics";
import { parseContourSegments, segmentToCurve, type SegmentContourLike } from "@shift/font";
import { Bounds, Curve, type Bounds as BoundsType } from "@shift/geo";

type CachedContourGeometry = { path: Path2D; isClosed: boolean; bounds: BoundsType | null };
const contourPathCache = new WeakMap<SegmentContourLike, CachedContourGeometry>();

/** Build and cache Path2D for a plain (non-reactive) contour. */
export function getCachedContourPath(contour: SegmentContourLike): CachedContourGeometry {
  const cached = contourPathCache.get(contour);
  if (cached) return cached;

  const path = new Path2D();
  if (contour.points.length < 2) {
    const result = { path, isClosed: false, bounds: null };
    contourPathCache.set(contour, result);
    return result;
  }

  const segments = parseContourSegments(contour);
  const firstSegment = segments[0];
  if (!firstSegment) {
    const result = { path, isClosed: false, bounds: null };
    contourPathCache.set(contour, result);
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
  contourPathCache.set(contour, result);
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
