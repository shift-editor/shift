import type { EntityId } from "@/lib/core/EntityId";

export type SegmentType = "line" | "quad" | "cubic";

/**
 * Minimal point interface for segments.
 * Compatible with both ContourPoint and PointSnapshot.
 */
export interface SegmentPoint {
  id: string;
  x: number;
  y: number;
  pointType: "onCurve" | "offCurve";
  smooth: boolean;
  /** EntityId is present on ContourPoint (legacy) */
  entityId?: EntityId;
}

/**
 * A line segment between two on-curve points.
 */
export type LineSegment = {
  type: "line";
  points: {
    anchor1: SegmentPoint;
    anchor2: SegmentPoint;
  };
};

/**
 * A quadratic bezier curve with one control point.
 * Pattern: onCurve → offCurve → onCurve
 */
export type QuadSegment = {
  type: "quad";
  points: {
    anchor1: SegmentPoint;
    control: SegmentPoint;
    anchor2: SegmentPoint;
  };
};

/**
 * A cubic bezier curve with two control points.
 * Pattern: onCurve → offCurve → offCurve → onCurve
 */
export type CubicSegment = {
  type: "cubic";
  points: {
    anchor1: SegmentPoint;
    control1: SegmentPoint;
    control2: SegmentPoint;
    anchor2: SegmentPoint;
  };
};

/**
 * A segment in a contour - either a line or bezier curve.
 */
export type Segment = LineSegment | QuadSegment | CubicSegment;
