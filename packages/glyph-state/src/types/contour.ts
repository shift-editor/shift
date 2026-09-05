import type { NewPoint, Point } from "../Point";
import type { Segment } from "../Segment";

/** Describes ordered contour points without requiring authored identity. */
export interface ContourGeometry<TPoint extends NewPoint = Point> {
  readonly points: readonly TPoint[];
  readonly closed: boolean;
}

/** Exposes domain-owned segment traversal for an authored contour. */
export interface SegmentedContour extends ContourGeometry {
  segments(): readonly Segment[];
}

export type LineSegmentPoints<TPoint extends NewPoint = Point> = {
  readonly type: "line";
  readonly start: TPoint;
  readonly end: TPoint;
};

export type QuadSegmentPoints<TPoint extends NewPoint = Point> = {
  readonly type: "quad";
  readonly start: TPoint;
  readonly control: TPoint;
  readonly end: TPoint;
};

export type CubicSegmentPoints<TPoint extends NewPoint = Point> = {
  readonly type: "cubic";
  readonly start: TPoint;
  readonly controlStart: TPoint;
  readonly controlEnd: TPoint;
  readonly end: TPoint;
};

export type SegmentPoints<TPoint extends NewPoint = Point> =
  | LineSegmentPoints<TPoint>
  | QuadSegmentPoints<TPoint>
  | CubicSegmentPoints<TPoint>;
