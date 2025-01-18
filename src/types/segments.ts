import { PathPoint } from "../lib/core/Path";

export type SegmentType = "line" | "quadratic" | "cubic";
export type Segment = {
  type: SegmentType;
  anchor: PathPoint;
  trailingHandle?: PathPoint;
  leadingHandle?: PathPoint;
};
