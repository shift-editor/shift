/**
 * Behavior — a single state-transition rule in the tool state machine.
 *
 * Each tool declares an ordered list of behaviors. On every event, BaseTool
 * iterates the list, finds the first behavior that `canHandle` the
 * (state, event) pair, and delegates the transition to it. This keeps each
 * behavior small and testable in isolation.
 *
 * @typeParam S - Tool state union (e.g. `PenState`, `SelectState`).
 * @typeParam E - Event type, defaults to {@link ToolEvent}.
 * @typeParam A - Action type emitted alongside state transitions. Tools
 *   without side-effect actions leave this as `never`.
 *
 * @module
 */
import type { ToolEvent } from "./GestureDetector";
import type { EditorAPI } from "./EditorAPI";

/**
 * Value returned by a successful behavior transition.
 *
 * Contains the next state and an optional action. The action is not embedded
 * in the state — it flows through {@link BaseTool.executeAction} for
 * side-effect handling, keeping state types pure.
 */
export type TransitionResult<S, A = never> = {
  state: S;
  action?: A;
};

/**
 * A composable state-transition rule.
 *
 * Behaviors are stateless objects — all mutable context lives in the tool
 * state `S` and the {@link EditorAPI}. Implement `canHandle` as a fast guard
 * (typically a state-type + event-type check) and `transition` as the pure
 * state computation. Use `onTransition` for post-transition side effects
 * that need both the previous and next states (e.g. starting a snap session).
 */
export interface Behavior<S, E = ToolEvent, A = never> {
  /** Return true if this behavior applies to the given (state, event) pair. */
  canHandle(state: S, event: E): boolean;
  /** Compute the next state. Return null to decline and let the next behavior try. */
  transition(state: S, event: E, editor: EditorAPI): TransitionResult<S, A> | null;
  /** Optional hook called after BaseTool commits the transition. Useful for side effects. */
  onTransition?(prev: S, next: S, event: E, editor: EditorAPI): void;
}

/**
 * Identity helper for defining a behavior as a plain object literal with
 * full type inference. Avoids the boilerplate of `satisfies Behavior<...>`.
 */
export function createBehavior<S, E = ToolEvent, A = never>(
  impl: Behavior<S, E, A>,
): Behavior<S, E, A> {
  return impl;
}
