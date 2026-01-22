import type { Point2D } from "@shift/types";

export type HandState =
  | { type: "idle" }
  | { type: "ready" }
  | { type: "dragging"; startPos: Point2D; startPan: Point2D };
