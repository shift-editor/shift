import { Bounds } from "@shift/geo";
import type { NewPoint } from "./Point";
import type { ContourGeometry, SegmentPoints } from "./types/contour";
import { contourGeometry, type SegmentBounds, type SegmentKind } from "./generated/geometryLayouts";

/** One segment's points, which are the contour's own, and its tight box. */
export interface ContourSegment<TPoint extends NewPoint> {
  readonly points: SegmentPoints<TPoint>;
  readonly bounds: Bounds;
}

/** A contour's segments in order, and the box around them. */
export interface SegmentedContourGeometry<TPoint extends NewPoint> {
  readonly segments: readonly ContourSegment<TPoint>[];
  /** `null` when the contour has no segment. */
  readonly bounds: Bounds | null;
}

const EMPTY: SegmentedContourGeometry<never> = { segments: [], bounds: null };

/**
 * Segments a contour and bounds each segment and the whole contour, as
 * shift-font segments it (`SegmentIndexIter`, `SegmentIndices::bounds`).
 *
 * @remarks
 * A closed contour holding a single on-curve point yields one zero-length
 * line, as the pen protocol draws it, so the point counts toward bounds as it
 * does in compiled glyph bounding boxes. One call crosses into the module
 * with the contour's point types and coordinates.
 *
 * @param contour - Ordered points and closure; closed contours wrap controls to the first anchor.
 * @returns Segments whose points are `contour`'s own, without allocating identities.
 */
export function segmentContour<TPoint extends NewPoint>(
  contour: ContourGeometry<TPoint>,
): SegmentedContourGeometry<TPoint> {
  const { points, closed } = contour;
  if (points.length === 0) return EMPTY;

  const coordinates: number[] = [];
  for (const point of points) coordinates.push(point.x, point.y);
  const geometry = contourGeometry({
    closed,
    pointTypes: points.map((point) => point.pointType),
    coordinates,
  });
  const boxes = geometry.segmentBounds;
  return {
    segments: geometry.kinds.map((kind, index) => ({
      points: segmentPoints(points, kind, geometry.firsts[index]!),
      bounds: Bounds.create(
        { x: boxes[index * 4]!, y: boxes[index * 4 + 1]! },
        { x: boxes[index * 4 + 2]!, y: boxes[index * 4 + 3]! },
      ),
    })),
    bounds: geometry.bounds ? toBounds(geometry.bounds) : null,
  };
}

function segmentPoints<TPoint extends NewPoint>(
  points: readonly TPoint[],
  kind: SegmentKind,
  first: number,
): SegmentPoints<TPoint> {
  // A segment's points are consecutive from `first`, wrapping on a closed contour.
  const at = (slot: number): TPoint => points[(first + slot) % points.length]!;
  switch (kind) {
    case "line":
      return { type: "line", start: at(0), end: at(1) };
    case "quad":
      return { type: "quad", start: at(0), control: at(1), end: at(2) };
    case "cubic":
      return { type: "cubic", start: at(0), controlStart: at(1), controlEnd: at(2), end: at(3) };
  }
}

function toBounds(bounds: SegmentBounds): Bounds {
  return Bounds.create({ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY });
}
