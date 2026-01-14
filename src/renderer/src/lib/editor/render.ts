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
import { Path2D } from "@/lib/graphics/Path";
import { Contour, type PointType } from "@/lib/core/Contour";

/**
 * Options for rendering a glyph.
 */
export interface RenderGlyphOptions {
  /** Whether to fill the glyph (vs just stroke). */
  fill?: boolean;
  /** Stroke style settings. */
  strokeStyle?: {
    color?: string;
    lineWidth?: number;
  };
  /** Fill style settings. */
  fillStyle?: {
    color?: string;
  };
}

/**
 * State for handle rendering (selection, hover).
 */
export interface HandleRenderState {
  selectedPoints: ReadonlySet<PointId>;
  hoveredPoint: PointId | null;
}

/**
 * Build a Path2D from a glyph snapshot.
 */
export function buildGlyphPath(snapshot: GlyphSnapshot): Path2D {
  const path = new Path2D();

  for (const contour of snapshot.contours) {
    if (contour.points.length < 2) {
      continue;
    }

    const segments = parseSegments(contour.points, contour.closed);
    if (segments.length === 0) continue;

    // Move to the first point
    const firstSegment = segments[0];
    path.moveTo(firstSegment.points.anchor1.x, firstSegment.points.anchor1.y);

    // Draw each segment
    for (const segment of segments) {
      switch (segment.type) {
        case "line":
          path.lineTo(segment.points.anchor2.x, segment.points.anchor2.y);
          break;
        case "quad":
          path.quadTo(
            segment.points.control.x,
            segment.points.control.y,
            segment.points.anchor2.x,
            segment.points.anchor2.y
          );
          break;
        case "cubic":
          path.cubicTo(
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
      path.closePath();
    }
  }

  return path;
}

/**
 * Render a glyph outline to a canvas context.
 */
export function renderGlyphOutline(
  ctx: IRenderer,
  snapshot: GlyphSnapshot,
  options: RenderGlyphOptions = {}
): void {
  const path = buildGlyphPath(snapshot);

  if (options.strokeStyle?.color) {
    ctx.strokeStyle = options.strokeStyle.color;
  }
  if (options.strokeStyle?.lineWidth) {
    ctx.lineWidth = options.strokeStyle.lineWidth;
  }

  ctx.stroke(path);

  if (options.fill && path.isClosed()) {
    if (options.fillStyle?.color) {
      ctx.fillStyle = options.fillStyle.color;
    }
    ctx.fill(path);
  }
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

// ═══════════════════════════════════════════════════════════
// SNAPSHOT TO CONTOUR CONVERSION (TEMPORARY)
// ═══════════════════════════════════════════════════════════

/**
 * Convert a GlyphSnapshot from Rust to TypeScript Contour objects for rendering.
 * This allows the Editor's Scene to render glyph data from Rust.
 *
 * Note: This is temporary until Scene is migrated to render directly from snapshots.
 * Creates new TypeScript Contour objects for rendering. The TypeScript
 * objects have their own EntityIds - we pass the Rust ID for point matching.
 */
export function snapshotToContours(snapshot: GlyphSnapshot): Contour[] {
  return snapshot.contours.map((contourSnap) => {
    const contour = new Contour();

    for (const pointSnap of contourSnap.points) {
      const pointType: PointType = pointSnap.pointType === 'onCurve' ? 'onCurve' : 'offCurve';
      // Pass the Rust ID so we can match points by ID later
      contour.addPoint(pointSnap.x, pointSnap.y, pointType, pointSnap.smooth, pointSnap.id);
    }

    if (contourSnap.closed) {
      contour.close();
    }

    return contour;
  });
}
