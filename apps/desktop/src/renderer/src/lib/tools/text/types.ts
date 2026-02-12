import type { Behavior, ToolEvent } from "../core";

export type TextState = { type: "idle" } | { type: "typing" };

export type TextAction =
  | { type: "insert"; codepoint: number }
  | { type: "delete" }
  | { type: "moveLeft" }
  | { type: "moveRight" }
  | { type: "cancel" };

export type TextBehavior = Behavior<TextState, ToolEvent, TextAction>;
