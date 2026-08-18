import type { Editor } from "@/lib/editor/Editor";
import type { ToolEvent } from "./GestureDetector";
import type { ToolName, ToolState } from "./createContext";
import type { Canvas } from "@/lib/editor/rendering/Canvas";
import type { Behavior, ToolContext } from "./Behavior";
import {
  batch,
  computed,
  signal,
  type ComputedSignal,
  type Signal,
  type WritableSignal,
} from "../../signals/signal";
import type { CursorType } from "@/types/editor";

export type { ToolName, ToolState };

/**
 * Base class for all editor tools (Pen, Select, Hand, Shape, Text).
 *
 * Implements a behavior-driven state machine: on each {@link ToolEvent},
 * `transition()` iterates the tool's {@link behaviors} list, finds the first
 * behavior that accepts the (state, event) pair, and applies its transition.
 * After the state updates, `onTransition()` fires actions and per-behavior
 * side effects.
 *
 * Subclasses declare:
 * - `id` / `initialState()` — tool identity and starting state.
 * - `behaviors` — ordered list of {@link Behavior} objects.
 * - `preTransition()` — optional short-circuit before the behavior loop.
 * - `onStateChange()` — optional hook after every committed transition.
 * - `drawBackground()` / `drawScene()` / `drawOverlay()` — per-frame drawing hooks.
 *
 * @typeParam S - The tool's state union (must extend `ToolState`).
 * @typeParam TTool - Concrete tool type exposed to typed behavior contexts.
 * @typeParam Settings - Optional per-tool settings object.
 */
export abstract class BaseTool<S extends ToolState, TTool = unknown, Settings = object> {
  abstract readonly id: ToolName;
  /** Ordered behavior list -- first match wins on each event. */
  abstract readonly behaviors: Behavior<S, TTool>[];
  readonly cursorCell: ComputedSignal<CursorType>;
  readonly isEditingCell: ComputedSignal<boolean>;
  readonly stateCell: Signal<S>;
  readonly #stateCell: WritableSignal<S>;
  #cancelCallbacks: Map<symbol, () => void> | null = null;
  state: S;
  /** @knipclassignore */
  settings: Settings;
  readonly editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
    this.state = this.initialState();
    this.#stateCell = signal<S>(this.state, {
      name: `tool.${this.constructor.name}.state`,
    });
    this.stateCell = this.#stateCell;
    this.settings = this.defaultSettings();
    this.cursorCell = computed(() => this.getCursor(this.stateCell.value), {
      name: `tool.${this.constructor.name}.cursor`,
    });
    this.isEditingCell = computed(() => this.isEditing(this.stateCell.value), {
      name: `tool.${this.constructor.name}.isEditing`,
    });
  }

  getCursor(state: S): CursorType {
    void state;
    return { type: "default" };
  }

  /** @knipclassignore */
  get name(): ToolName {
    return this.id;
  }

  abstract initialState(): S;

  defaultSettings(): Settings {
    return {} as Settings;
  }

  protected isEditing(state: S): boolean {
    void state;
    return false;
  }

  /** Return a state to short-circuit the behavior loop, or null to continue. */
  protected preTransition?(state: S, event: ToolEvent): { state: S } | null;
  protected onStateChange?(prev: S, next: S, event: ToolEvent): void;

  /** Layer 0 — rarely redraws (viewport/font change only). Text runs, background elements. */
  drawBackground?(canvas: Canvas): void;

  /** Layer 1 — redraws on edit/selection/hover change. Guides, outline, handles, segments. */
  drawScene?(canvas: Canvas): void;

  /** Layer 2 — redraws every mouse move. Selection marquee, cursor. */
  drawOverlay?(canvas: Canvas): void;

  activate?(): void;
  deactivate?(): void;

  /** Permanently severs this instance's reactive dependencies; it cannot be resumed. */
  dispose(): void {
    try {
      this.#cancelDrag();
    } finally {
      this.cursorCell.dispose();
      this.isEditingCell.dispose();
    }
  }

  /** @knipclassignore — transition API used by tool tests/debugging. */
  transition(state: S, event: ToolEvent): S {
    try {
      this.#beginEvent(event);
      const next = this.#runBehaviors(state, event).state;
      this.#finishEvent(event);
      return next;
    } catch (error) {
      this.#cancelAfterFailure(error);
    }
  }

  handleEvent(event: ToolEvent): boolean {
    try {
      this.#beginEvent(event);

      const prev = this.state;
      const result = this.#runBehaviors(prev, event);
      const next = result.state;

      this.#finishEvent(event);

      if (next !== prev) {
        batch(() => {
          const preCommitContext = this.#createContext(
            () => prev,
            () => {},
            event,
          );
          for (const behavior of this.behaviors) {
            if (behavior.onStateExit) behavior.onStateExit(prev, next, preCommitContext, event);
          }

          this.setState(next);

          const postCommitContext = this.#createContext(
            () => this.state,
            (nextState: S) => {
              this.setState(nextState);
            },
            event,
          );
          for (const behavior of this.behaviors) {
            if (behavior.onStateEnter) behavior.onStateEnter(prev, next, postCommitContext, event);
          }

          if (this.onStateChange) this.onStateChange(prev, next, event);
        });
      }

      return result.handled;
    } catch (error) {
      this.#cancelAfterFailure(error);
    }
  }

  getState(): S {
    return this.state;
  }

  protected setState(next: S): void {
    this.state = next;
    this.#stateCell.set(next);
  }

  #runBehaviors(state: S, event: ToolEvent): { state: S; handled: boolean } {
    if (state.type === "idle") {
      return { state, handled: false };
    }

    if (this.preTransition) {
      const result = this.preTransition(state, event);
      if (result !== null) {
        return { state: result.state, handled: true };
      }
    }

    let nextState = state;
    const dispatchContext = this.#createContext(
      () => nextState,
      (next: S) => {
        nextState = next;
      },
      event,
    );

    for (const behavior of this.behaviors) {
      const handler = this.#getEventHandler(behavior, event.type);
      if (handler) {
        const handled = handler.call(behavior, nextState, dispatchContext, event as never);
        if (handled) {
          return { state: nextState, handled: true };
        }
      }
    }

    return { state: nextState, handled: false };
  }

  #createContext(
    getState: () => S,
    setState: (next: S) => void,
    event: ToolEvent,
  ): ToolContext<S, TTool> {
    return {
      editor: this.editor,
      tool: this as unknown as TTool,
      getState,
      setState,
      onCancel: (callback) => this.#onCancel(event, callback),
    };
  }

  #beginEvent(event: ToolEvent): void {
    if (event.type !== "dragStart") return;

    this.#cancelDrag();
    this.#cancelCallbacks = new Map();
  }

  #finishEvent(event: ToolEvent): void {
    if (event.type !== "dragEnd" && event.type !== "dragCancel") return;
    this.#cancelDrag();
  }

  #onCancel(event: ToolEvent, callback: () => void): () => void {
    if (event.type !== "dragStart" && event.type !== "drag") {
      throw new Error("ToolContext.onCancel is only available during a drag");
    }
    const callbacks = (this.#cancelCallbacks ??= new Map());
    const key = Symbol("drag cancellation");
    callbacks.set(key, callback);

    return () => {
      callbacks.delete(key);
    };
  }

  #cancelDrag(): void {
    const callbacks = this.#cancelCallbacks;
    this.#cancelCallbacks = null;
    if (!callbacks) return;

    let failed = false;
    let firstError: unknown;
    for (const callback of [...callbacks.values()].reverse()) {
      try {
        callback();
      } catch (error) {
        if (failed) continue;
        failed = true;
        firstError = error;
      }
    }

    if (failed) throw firstError;
  }

  #cancelAfterFailure(error: unknown): never {
    try {
      this.#cancelDrag();
    } catch (cancelError) {
      throw new AggregateError([error, cancelError], "Tool event and cancellation both failed");
    }

    throw error;
  }

  #getEventHandler(
    behavior: Behavior<S, TTool>,
    type: ToolEvent["type"],
  ): ((state: S, ctx: ToolContext<S, TTool>, event: ToolEvent) => boolean | undefined) | undefined {
    switch (type) {
      case "pointerMove":
        return behavior.onPointerMove as
          | ((state: S, ctx: ToolContext<S, TTool>, event: ToolEvent) => boolean | undefined)
          | undefined;
      case "click":
        return behavior.onClick as
          | ((state: S, ctx: ToolContext<S, TTool>, event: ToolEvent) => boolean | undefined)
          | undefined;
      case "doubleClick":
        return behavior.onDoubleClick as
          | ((state: S, ctx: ToolContext<S, TTool>, event: ToolEvent) => boolean | undefined)
          | undefined;
      case "dragStart":
        return behavior.onDragStart as
          | ((state: S, ctx: ToolContext<S, TTool>, event: ToolEvent) => boolean | undefined)
          | undefined;
      case "drag":
        return behavior.onDrag as
          | ((state: S, ctx: ToolContext<S, TTool>, event: ToolEvent) => boolean | undefined)
          | undefined;
      case "dragEnd":
        return behavior.onDragEnd as
          | ((state: S, ctx: ToolContext<S, TTool>, event: ToolEvent) => boolean | undefined)
          | undefined;
      case "dragCancel":
        return behavior.onDragCancel as
          | ((state: S, ctx: ToolContext<S, TTool>, event: ToolEvent) => boolean | undefined)
          | undefined;
      case "keyDown":
        return behavior.onKeyDown as
          | ((state: S, ctx: ToolContext<S, TTool>, event: ToolEvent) => boolean | undefined)
          | undefined;
      case "keyUp":
        return behavior.onKeyUp as
          | ((state: S, ctx: ToolContext<S, TTool>, event: ToolEvent) => boolean | undefined)
          | undefined;
      default:
        return undefined;
    }
  }
}
