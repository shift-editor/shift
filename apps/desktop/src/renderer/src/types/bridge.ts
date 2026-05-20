import type { ContourId, PointId, PointType } from "@shift/types";

export interface PasteResult {
  createdPointIds: PointId[];
  createdContourIds: ContourId[];
}

export interface PointEdit {
  id?: PointId;
  x: number;
  y: number;
  pointType: PointType;
  smooth: boolean;
}
