import type { Point2D, PointId, ContourId, ContourSnapshot } from "@shift/types";

export type PointHitResult = {
  contourId: ContourId;
  pointIndex: number;
  position: "start" | "end" | "middle";
  contour: ContourSnapshot;
};

export type PenState =
  | { type: "idle" }
  | { type: "ready"; mousePos: Point2D }
  | { type: "anchored"; anchor: AnchorData }
  | {
      type: "dragging";
      anchor: AnchorData;
      handles: HandleData;
      mousePos: Point2D;
    };

export interface AnchorData {
  position: Point2D;
  pointId: PointId;
  context: ContourContext;
}

export interface HandleData {
  cpIn?: PointId;
  cpOut?: PointId;
}

export interface ContourContext {
  previousPointType: "none" | "onCurve" | "offCurve";
  previousOnCurvePosition: Point2D | null;
  isFirstPoint: boolean;
}

export interface PlaceAnchorResult {
  pointId: PointId;
}

export interface CreateHandlesResult {
  handles: HandleData;
}

export const DRAG_THRESHOLD = 3;
