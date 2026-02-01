import type { Point2D } from "@shift/types";
import type { ToolEvent } from "../core/GestureDetector";
import type { Behavior } from "../core/Behavior";

export type HandState =
  | { type: "idle" }
  | { type: "ready" }
  | { type: "dragging"; screenStart: Point2D; startPan: Point2D };

export type HandBehavior = Behavior<HandState, ToolEvent>;
