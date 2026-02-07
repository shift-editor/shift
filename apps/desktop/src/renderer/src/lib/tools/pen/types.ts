import type { Point2D, PointId } from "@shift/types";
import type { ToolEvent } from "../core/GestureDetector";
import type { Behavior } from "../core/Behavior";
import type { PenAction } from "./actions";
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

export type PenState =
  | { type: "idle" }
  | { type: "ready"; mousePos: Point2D }
  | { type: "anchored"; anchor: AnchorData }
  | {
      type: "dragging";
      anchor: AnchorData;
      handles: HandleData;
      mousePos: Point2D;
      snappedPos?: Point2D;
    };

export type PenBehavior = Behavior<PenState, ToolEvent, PenAction>;
