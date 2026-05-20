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
import type { Editor } from "@/lib/editor/Editor";
import type { ToolEvent, ToolEventOf } from "./GestureDetector";

export interface ToolContext<S, TTool = unknown> {
  readonly editor: Editor;
  readonly tool: TTool;
  getState(): S;
  setState(next: S): void;
}

/**
 * A composable state-transition rule.
 *
 * Behaviors are stateless objects — all mutable context lives in the tool
 * state `S` and the {@link Editor}. Implement `canHandle` as a fast guard
 * (typically a state-type + event-type check) and `transition` as the pure
 * state computation. Use `onTransition` for post-transition side effects
 * that need both the previous and next states.
 */
export interface Behavior<S, TTool = unknown> {
  // New explicit event handlers
  onPointerMove?(state: S, ctx: ToolContext<S, TTool>, event: ToolEventOf<"pointerMove">): boolean;
  onClick?(state: S, ctx: ToolContext<S, TTool>, event: ToolEventOf<"click">): boolean;
  onDoubleClick?(state: S, ctx: ToolContext<S, TTool>, event: ToolEventOf<"doubleClick">): boolean;
  onDragStart?(state: S, ctx: ToolContext<S, TTool>, event: ToolEventOf<"dragStart">): boolean;
  onDrag?(state: S, ctx: ToolContext<S, TTool>, event: ToolEventOf<"drag">): boolean;
  onDragEnd?(state: S, ctx: ToolContext<S, TTool>, event: ToolEventOf<"dragEnd">): boolean;
  onDragCancel?(state: S, ctx: ToolContext<S, TTool>, event: ToolEventOf<"dragCancel">): boolean;
  onKeyDown?(state: S, ctx: ToolContext<S, TTool>, event: ToolEventOf<"keyDown">): boolean;
  onKeyUp?(state: S, ctx: ToolContext<S, TTool>, event: ToolEventOf<"keyUp">): boolean;
  onStateExit?(prev: S, next: S, ctx: ToolContext<S, TTool>, event: ToolEvent): void;
  onStateEnter?(prev: S, next: S, ctx: ToolContext<S, TTool>, event: ToolEvent): void;
}

/**
 * Identity helper for defining a behavior as a plain object literal with
 * full type inference. Avoids the boilerplate of `satisfies Behavior<...>`.
 */
export function createBehavior<S, TTool = unknown>(impl: Behavior<S, TTool>): Behavior<S, TTool> {
  return impl;
}
