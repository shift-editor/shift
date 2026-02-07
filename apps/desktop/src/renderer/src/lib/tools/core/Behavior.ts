import type { ToolEvent } from "./GestureDetector";
import type { ToolContext } from "./ToolContext";

export type TransitionResult<S, A = never> = {
  state: S;
  action?: A;
};

export interface Behavior<S, E = ToolEvent, A = never> {
  canHandle(state: S, event: E): boolean;
  transition(state: S, event: E, editor: ToolContext): TransitionResult<S, A> | null;
  onTransition?(prev: S, next: S, event: E, editor: ToolContext): void;
}

export function createBehavior<S, E = ToolEvent, A = never>(
  impl: Behavior<S, E, A>,
): Behavior<S, E, A> {
  return impl;
}
