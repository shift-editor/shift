import type { Point2D } from "@shift/types";
import type { ToolEvent } from "../core/GestureDetector";
import type { Behavior } from "../core/Behavior";

export type ShapeState =
  | { type: "idle" }
  | { type: "ready" }
  | { type: "dragging"; startPos: Point2D; currentPos: Point2D };

export type ShapeBehavior = Behavior<ShapeState, ToolEvent>;
