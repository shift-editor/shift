import type { ToolEvent } from "./GestureDetector";
import type { ToolContext } from "./ToolContext";
import type { DrawAPI } from "./DrawAPI";

export interface Behavior<S, E = ToolEvent> {
  canHandle(state: S, event: E): boolean;
  transition(state: S, event: E, editor: ToolContext): S | null;
  onTransition?(prev: S, next: S, event: E, editor: ToolContext): void;
  render?(draw: DrawAPI, state: S, editor: ToolContext): void;
}

export function createBehavior<S, E = ToolEvent>(impl: Behavior<S, E>): Behavior<S, E> {
  return impl;
}
