<<<<<<< Updated upstream
import type { Behavior } from "../core";

export type TextState = { type: "idle" } | { type: "typing" };

export type TextBehavior = Behavior<TextState>;
=======
<<<<<<< Updated upstream
import type { Behavior, ToolEvent } from "../core";

export type TextState = { type: "idle" } | { type: "typing" };

export type TextAction =
  | { type: "insert"; codepoint: number }
  | { type: "delete" }
  | { type: "moveLeft" }
  | { type: "moveRight" }
  | { type: "cancel" };

export type TextBehavior = Behavior<TextState, ToolEvent, TextAction>;
=======
import type { Behavior } from "../core/Behavior";
import type { ToolEvent } from "../core/GestureDetector";
import type { ToolContext } from "../core/ToolContext";

export interface LayoutGlyph {
  unicode: number;
  char: string;
  svgPath: string | null;
  xOffset: number;
  advance: number;
}

export type TextState =
  | { type: "idle" }
  | { type: "ready" }
  | { type: "typing"; text: string; cursorIndex: number; layout: LayoutGlyph[] }
  | {
      type: "editing-glyph";
      text: string;
      cursorIndex: number;
      layout: LayoutGlyph[];
      editingIndex: number;
      originalUnicode: number;
    };

export type TextIntent =
  | { action: "startGlyphEdit"; unicode: number; glyphIndex: number }
  | { action: "returnFromGlyphEdit" };

export interface TextBehavior extends Behavior<TextState, ToolEvent> {
  canHandle(state: TextState, event: ToolEvent): boolean;
  transition(state: TextState, event: ToolEvent, editor: ToolContext): TextState | null;
  onTransition?(prev: TextState, next: TextState, event: ToolEvent, editor: ToolContext): void;
}
>>>>>>> Stashed changes
>>>>>>> Stashed changes
