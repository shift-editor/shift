/**
 * Pure rendering functions for glyph visualization.
 *
 * These functions take snapshot data and render to a canvas context.
 * No state is maintained - each call renders based on the provided data.
 */

import type { GlyphSnapshot, PointSnapshot, ContourSnapshot } from "@/types/generated";
import type { PointId } from "@/types/ids";
import type { IRenderer } from "@/types/graphics";
import { parseSegments } from "@/engine/segments";

export interface Guides {
  xAdvance: number;
  ascender: { y: number };
  capHeight: { y: number };
  xHeight: { y: number };
  baseline: { y: number };
  descender: { y: number };
}

export interface HandleRenderState {
  selectedPoints: ReadonlySet<PointId>;
  hoveredPoint: PointId | null;
}

export function renderGlyph(ctx: IRenderer, snapshot: GlyphSnapshot): boolean {
  let hasClosed = false;

  for (const contour of snapshot.contours) {
    if (contour.points.length < 2) {
      continue;
    }

    const segments = parseSegments(contour.points, contour.closed);
    if (segments.length === 0) continue;

    ctx.beginPath();
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
            segment.points.anchor2.y
          );
          break;
        case "cubic":
          ctx.cubicTo(
            segment.points.control1.x,
            segment.points.control1.y,
            segment.points.control2.x,
            segment.points.control2.y,
            segment.points.anchor2.x,
            segment.points.anchor2.y
          );
          break;
      }
    }

    if (contour.closed) {
      ctx.closePath();
      hasClosed = true;
    }

    ctx.stroke();
  }

  return hasClosed;
}

export function renderGuides(ctx: IRenderer, guides: Guides): void {
  ctx.beginPath();

  for (const y of [
    guides.ascender.y,
    guides.capHeight.y,
    guides.xHeight.y,
    guides.baseline.y,
    guides.descender.y
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
 * Get the handle state for a point (idle, hovered, selected).
 */
export function getPointHandleState(
  pointId: string,
  state: HandleRenderState
): "idle" | "hovered" | "selected" {
  if (state.selectedPoints.has(pointId as PointId)) {
    return "selected";
  }
  if (state.hoveredPoint === pointId) {
    return "hovered";
  }
  return "idle";
}

/**
 * Determine the handle type for a point in a contour.
 */
export function getHandleType(
  point: PointSnapshot,
  index: number,
  contour: ContourSnapshot
): "first" | "last" | "direction" | "corner" | "smooth" | "control" {
  const points = contour.points;
  const isFirst = index === 0;
  const isLast = index === points.length - 1;

  // First point in open contour
  if (isFirst && !contour.closed) {
    return "first";
  }

  // First point in closed contour (direction indicator)
  if (isFirst && contour.closed) {
    return "direction";
  }

  // Last point in open contour
  if (isLast && !contour.closed) {
    return "last";
  }

  // Off-curve control point
  if (point.pointType === "offCurve") {
    return "control";
  }

  // On-curve point
  if (point.smooth) {
    return "smooth";
  }

  return "corner";
}

/**
 * Find a point in a snapshot by ID.
 */
export function findPointInSnapshot(
  snapshot: GlyphSnapshot,
  pointId: PointId
): { point: PointSnapshot; contour: ContourSnapshot; index: number } | null {
  for (const contour of snapshot.contours) {
    const index = contour.points.findIndex((p) => p.id === pointId);
    if (index !== -1) {
      return {
        point: contour.points[index],
        contour,
        index,
      };
    }
  }
  return null;
}

/**
 * Get all points from a snapshot as a flat array with contour info.
 */
export function getAllPointsFromSnapshot(
  snapshot: GlyphSnapshot
): Array<{ point: PointSnapshot; contour: ContourSnapshot; index: number }> {
  const result: Array<{ point: PointSnapshot; contour: ContourSnapshot; index: number }> = [];

  for (const contour of snapshot.contours) {
    for (let i = 0; i < contour.points.length; i++) {
      result.push({
        point: contour.points[i],
        contour,
        index: i,
      });
    }
  }

  return result;
}

/**
 * Check if a contour is clockwise using the shoelace formula.
 */
export function isContourClockwise(contour: ContourSnapshot): boolean {
  const points = contour.points;
  if (points.length < 3) return true;

  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    sum += (p2.x - p1.x) * (p2.y + p1.y);
  }

  return sum > 0;
}
