import { Point2D } from "@shift/types";
import { Behavior, ToolEvent } from "../core";
import { TextLayout } from "./layout";

export type TextState =
  | { type: "idle" }
  | { type: "ready"; layout: TextLayout }
  | { type: "typing"; layout: TextLayout }
  | { type: "brushing"; origin: Point2D; layout: TextLayout };

export type TextAction =
  | { type: "delete" }
  | { type: "cancel" }
  | { type: "moveLeft" }
  | { type: "selectLeft"; index: number }
  | { type: "deselectLeft"; index: number }
  | { type: "moveRight" }
  | { type: "selectRight"; index: number }
  | { type: "deselectRight"; index: number }
  | { type: "selectAll"; index: number }
  | { type: "deselectAll"; index: number }
  | { type: "insert"; codepoint: number };

export type TextBehavior = Behavior<TextState, ToolEvent, TextAction>;
