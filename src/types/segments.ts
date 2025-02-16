import { ContourPoint } from "../lib/core/Contour";

export type SegmentType = "line" | "quadratic" | "cubic";
export type Segment = {
  type: SegmentType;
  anchor: ContourPoint;
  trailingHandle?: ContourPoint;
  leadingHandle?: ContourPoint;
};
