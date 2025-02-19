import { Point2D } from "./math";

export type SegmentType = "line" | "cubic";

export type LineSegment = {
  type: "line";
  anchor0: Point2D;
  anchor1: Point2D;
};

export type CubicSegment = {
  type: "cubic";
  anchor0: Point2D;
  control0: Point2D;
  control1: Point2D;
  anchor1: Point2D;
};

export type Segment = LineSegment | CubicSegment;
