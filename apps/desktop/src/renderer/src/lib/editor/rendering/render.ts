/**
 * Pure rendering functions for glyph visualization.
 *
 * These functions take snapshot data and render to a canvas context.
 * No state is maintained - each call renders based on the provided data.
 */

import type { GlyphSnapshot, ContourSnapshot } from "@shift/types";
import type { IRenderer } from "@/types/graphics";
import { Polygon } from "@shift/geo";
import { Segment } from "@/lib/geo/Segment";

export interface Guides {
  xAdvance: number;
  ascender: { y: number };
  capHeight: { y: number };
  xHeight: { y: number };
  baseline: { y: number };
  descender: { y: number };
}

export function buildContourPath(ctx: IRenderer, contour: ContourSnapshot): boolean {
  if (contour.points.length < 2) return false;
  const segments = Segment.parse(contour.points, contour.closed);
  if (segments.length === 0) return false;
  ctx.moveTo(segments[0].points.anchor1.x, segments[0].points.anchor1.y);

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

export function renderGlyph(ctx: IRenderer, snapshot: GlyphSnapshot): boolean {
  let hasClosed = false;

  ctx.beginPath();
  for (const contour of snapshot.contours) {
    const isClosed = buildContourPath(ctx, contour);
    if (isClosed) hasClosed = true;
  }
  ctx.stroke();

  return hasClosed;
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

export function isContourClockwise(contour: ContourSnapshot): boolean {
  return Polygon.isClockwise(contour.points);
}
