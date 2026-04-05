import type { Point2D, PointId } from "@shift/types";
import type { Behavior } from "../core/Behavior";

export interface AnchorData {
  position: Point2D;
  pointId: PointId;
}

export interface HandleData {
  cpIn?: PointId;
  cpOut?: PointId;
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

export type PenBehavior = Behavior<PenState>;
