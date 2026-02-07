import { Behavior, ToolEvent } from "../core";

export type TextState = { type: "idle" } | { type: "ready" } | { type: "typing" };

export type TextAction =
  | { type: "delete" }
  | { type: "cancel" }
  | { type: "moveLeft" }
  | { type: "moveRight" };

export type TextBehavior = Behavior<TextState, ToolEvent, TextAction>;

export type TextLayout = {
  codepoints: number[];
  cursorPosition: number;
};
