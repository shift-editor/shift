import type { Point2D } from "@shift/geo";
import type { PointId } from "@shift/types";
import type { Behavior } from "../core/Behavior";

export interface Anchor {
  position: Point2D;
  pointId?: PointId;
}

export interface Handles {
  cpIn?: PointId;
  cpOut?: PointId;
}

export type PenState =
  | { type: "idle" }
  | { type: "ready" }
  | { type: "anchored"; anchor: Anchor }
  | {
      type: "dragging";
      anchor: Anchor;
      handles: Handles;
      mousePos: Point2D;
    };

export type PenBehavior = Behavior<PenState>;
