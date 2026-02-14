/**
 * Pure rendering functions for glyph visualization.
 *
 * These functions take snapshot data and render to a canvas context.
 * No state is maintained - each call renders based on the provided data.
 */

import type { Contour, Glyph, Point, PointType } from "@shift/types";
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

type RenderPathPoint = {
  readonly x: number;
  readonly y: number;
  readonly pointType: PointType;
  readonly smooth: boolean;
  readonly id?: unknown;
};

type RenderPathContour = {
  readonly points: readonly RenderPathPoint[];
  readonly closed: boolean;
};

function* iterateRenderContours(glyph: Glyph): Iterable<RenderPathContour> {
  for (const contour of glyph.contours) {
    yield contour;
  }
  for (const contour of glyph.compositeContours ?? []) {
    yield contour;
  }
}

function normalizeSegmentPoints(points: readonly RenderPathPoint[]): Point[] {
  return points.map((point, index) => {
    const id = (point.id ?? `render-${index}`) as Point["id"];
    return {
      id,
      x: point.x,
      y: point.y,
      pointType: point.pointType,
      smooth: point.smooth,
    } as Point;
  });
}

/**
 * Traces the contour's segments into the current path without stroking or filling.
 * Returns `true` if the contour is closed (caller can decide to fill).
 */
export function buildContourPath(ctx: IRenderer, contour: RenderPathContour): boolean {
  if (contour.points.length < 2) return false;
  const segments = Segment.parse(normalizeSegmentPoints(contour.points), contour.closed);
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

/**
 * Strokes every contour of the glyph.
 * Returns `true` if at least one contour is closed (filled preview is viable).
 */
export function renderGlyph(ctx: IRenderer, glyph: Glyph): boolean {
  let hasClosed = false;

  ctx.beginPath();
  for (const contour of iterateRenderContours(glyph)) {
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

/**
 * Tests contour winding direction. Clockwise contours define filled regions
 * under the non-zero fill rule; counter-clockwise contours define holes.
 */
export function isContourClockwise(contour: Contour): boolean {
  return Polygon.isClockwise(contour.points);
}
