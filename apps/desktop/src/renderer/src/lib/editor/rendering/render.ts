/**
 * Pure rendering helpers for contour visualization.
 *
 * {@link buildContourPath} traces a contour's segments onto an IRenderer
 * context. Used by composite inspection rendering.
 */

import type { IRenderer } from "@/types/graphics";
import { parseContourSegments, type SegmentContourLike } from "@shift/font";

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
