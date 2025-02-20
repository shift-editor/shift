import { Point2D } from "./math";

export type SegmentType = "line" | "cubic";

export type LineSegment = {
  type: "line";
  anchor1: Point2D;
  anchor2: Point2D;
};

export type CubicSegment = {
  type: "cubic";
  anchor1: Point2D;
  control1: Point2D;
  control2: Point2D;
  anchor2: Point2D;
};

export type Segment = LineSegment | CubicSegment;
