import { Bounds, Curve, type CurveType } from "@shift/geo";
import type { Glyph, Point } from "@shift/types";

export interface SegmentPointGeometry {
  readonly x: number;
  readonly y: number;
  readonly pointType: Point["pointType"];
  readonly smooth: boolean;
  readonly id?: Point["id"];
}

export interface ContourLike {
  readonly points: readonly SegmentPointGeometry[];
  readonly closed: boolean;
}

export type LineSegmentGeometry = {
  readonly type: "line";
  readonly points: {
    readonly anchor1: SegmentPointGeometry;
    readonly anchor2: SegmentPointGeometry;
  };
};

export type QuadSegmentGeometry = {
  readonly type: "quad";
  readonly points: {
    readonly anchor1: SegmentPointGeometry;
    readonly control: SegmentPointGeometry;
    readonly anchor2: SegmentPointGeometry;
  };
};

export type CubicSegmentGeometry = {
  readonly type: "cubic";
  readonly points: {
    readonly anchor1: SegmentPointGeometry;
    readonly control1: SegmentPointGeometry;
    readonly control2: SegmentPointGeometry;
    readonly anchor2: SegmentPointGeometry;
  };
};

export type SegmentGeometry = LineSegmentGeometry | QuadSegmentGeometry | CubicSegmentGeometry;

function isOnCurve(point: SegmentPointGeometry): boolean {
  return point.pointType === "onCurve";
}

function isOffCurve(point: SegmentPointGeometry): boolean {
  return point.pointType === "offCurve";
}

export function* iterateRenderableContours(glyph: Glyph): Iterable<ContourLike> {
  for (const contour of glyph.contours ?? []) {
    yield contour;
  }
  for (const contour of glyph.compositeContours ?? []) {
    yield contour;
  }
}

export function parseContourSegments(contour: ContourLike): SegmentGeometry[] {
  const { points, closed } = contour;
  if (points.length < 2) {
    return [];
  }

  const segments: SegmentGeometry[] = [];
  let index = 0;

  const getPoint = (i: number): SegmentPointGeometry | undefined => {
    if (i < points.length) {
      return points[i];
    }
    if (closed) {
      return points[i - points.length];
    }
    return undefined;
  };

  const limit = closed ? points.length : points.length - 1;

  while (index < limit) {
    const p1 = getPoint(index);
    const p2 = getPoint(index + 1);

    if (!p1 || !p2) {
      break;
    }

    if (isOnCurve(p1) && isOnCurve(p2)) {
      segments.push({
        type: "line",
        points: { anchor1: p1, anchor2: p2 },
      });
      index += 1;
      continue;
    }

    if (isOnCurve(p1) && isOffCurve(p2)) {
      const p3 = getPoint(index + 2);

      if (!p3) {
        break;
      }

      if (isOnCurve(p3)) {
        segments.push({
          type: "quad",
          points: { anchor1: p1, control: p2, anchor2: p3 },
        });
        index += 2;
        continue;
      }

      if (isOffCurve(p3)) {
        const p4 = getPoint(index + 3);
        if (!p4) {
          break;
        }

        segments.push({
          type: "cubic",
          points: { anchor1: p1, control1: p2, control2: p3, anchor2: p4 },
        });
        index += 3;
        continue;
      }
    }

    index += 1;
  }

  return segments;
}

export function segmentToCurve(segment: SegmentGeometry): CurveType {
  switch (segment.type) {
    case "line":
      return Curve.line(segment.points.anchor1, segment.points.anchor2);
    case "quad":
      return Curve.quadratic(
        segment.points.anchor1,
        segment.points.control,
        segment.points.anchor2,
      );
    case "cubic":
      return Curve.cubic(
        segment.points.anchor1,
        segment.points.control1,
        segment.points.control2,
        segment.points.anchor2,
      );
  }
}

export function deriveGlyphTightBounds(glyph: Glyph): Bounds | null {
  const bounds: Bounds[] = [];

  for (const contour of iterateRenderableContours(glyph)) {
    for (const segment of parseContourSegments(contour)) {
      bounds.push(Curve.bounds(segmentToCurve(segment)));
    }
  }

  return Bounds.unionAll(bounds);
}

export function deriveGlyphXBounds(glyph: Glyph): { minX: number; maxX: number } | null {
  const bounds = deriveGlyphTightBounds(glyph);
  if (!bounds) return null;
  return { minX: bounds.min.x, maxX: bounds.max.x };
}
