import type { ContourId, GlyphSnapshot, PointId, PointType } from "@shift/types";

export interface CommandResponse {
  snapshot: GlyphSnapshot;
  affectedPointIds: PointId[];
}

export interface PasteResult {
  success: boolean;
  createdPointIds: PointId[];
  createdContourIds: ContourId[];
  error?: string;
}

export interface PointEdit {
  id?: PointId;
  x: number;
  y: number;
  pointType: PointType;
  smooth: boolean;
}
