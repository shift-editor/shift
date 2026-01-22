import type { Point2D } from "@shift/types";

export type ShapeState =
  | { type: "idle" }
  | { type: "ready" }
  | { type: "dragging"; startPos: Point2D };
