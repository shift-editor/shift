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
export abstract class BaseTool<
  S extends ToolState,
  TTool = unknown,
  Settings = object,
> {
  abstract readonly id: ToolName;
  /** Ordered behavior list -- first match wins on each event. */
  abstract readonly behaviors: Behavior<S, TTool>[];
  readonly cursorCell: ComputedSignal<CursorType>;
  readonly stateCell: Signal<S>;
  readonly #stateCell: WritableSignal<S>;
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

  /** @knipclassignore — pure transition API used by tool tests/debugging. */
  transition(state: S, event: ToolEvent): S {
    return this.#runBehaviors(state, event).state;
  }

  handleEvent(event: ToolEvent): boolean {
    const prev = this.state;
    const result = this.#runBehaviors(prev, event);
    const next = result.state;

    if (next !== prev) {
      batch(() => {
        const preCommitContext = this.#createContext(
          () => prev,
          () => {},
        );
        for (const behavior of this.behaviors) {
          if (behavior.onStateExit)
            behavior.onStateExit(prev, next, preCommitContext, event);
        }

        this.setState(next);

        const postCommitContext = this.#createContext(
          () => this.state,
          (nextState: S) => {
            this.setState(nextState);
          },
        );
        for (const behavior of this.behaviors) {
          if (behavior.onStateEnter)
            behavior.onStateEnter(prev, next, postCommitContext, event);
        }

        if (this.onStateChange) this.onStateChange(prev, next, event);
      });
    }

    return result.handled;
  }

  getState(): S {
    return this.state;
  }

  protected setState(next: S): void {
    this.state = next;
    this.#stateCell.set(next);
    this.editor.setActiveToolState(next);
  }

  /** Execute `fn` inside a named command batch. Automatically rolls back on exception. */
  /** @knipclassignore — command batching helper for tool subclasses. */
  protected batch<T>(name: string, fn: () => T): T {
    return this.editor.commands.withBatch(name, fn);
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
    );

    for (const behavior of this.behaviors) {
      const handler = this.#getEventHandler(behavior, event.type);
      if (handler) {
        const handled = handler.call(
          behavior,
          nextState,
          dispatchContext,
          event as never,
        );
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
  ): ToolContext<S, TTool> {
    return {
      editor: this.editor,
      tool: this as unknown as TTool,
      getState,
      setState,
    };
  }

  #getEventHandler(
    behavior: Behavior<S, TTool>,
    type: ToolEvent["type"],
  ):
    | ((
        state: S,
        ctx: ToolContext<S, TTool>,
        event: ToolEvent,
      ) => boolean | undefined)
    | undefined {
    switch (type) {
      case "pointerMove":
        return behavior.onPointerMove as
          | ((
              state: S,
              ctx: ToolContext<S, TTool>,
              event: ToolEvent,
            ) => boolean | undefined)
          | undefined;
      case "click":
        return behavior.onClick as
          | ((
              state: S,
              ctx: ToolContext<S, TTool>,
              event: ToolEvent,
            ) => boolean | undefined)
          | undefined;
      case "doubleClick":
        return behavior.onDoubleClick as
          | ((
              state: S,
              ctx: ToolContext<S, TTool>,
              event: ToolEvent,
            ) => boolean | undefined)
          | undefined;
      case "dragStart":
        return behavior.onDragStart as
          | ((
              state: S,
              ctx: ToolContext<S, TTool>,
              event: ToolEvent,
            ) => boolean | undefined)
          | undefined;
      case "drag":
        return behavior.onDrag as
          | ((
              state: S,
              ctx: ToolContext<S, TTool>,
              event: ToolEvent,
            ) => boolean | undefined)
          | undefined;
      case "dragEnd":
        return behavior.onDragEnd as
          | ((
              state: S,
              ctx: ToolContext<S, TTool>,
              event: ToolEvent,
            ) => boolean | undefined)
          | undefined;
      case "dragCancel":
        return behavior.onDragCancel as
          | ((
              state: S,
              ctx: ToolContext<S, TTool>,
              event: ToolEvent,
            ) => boolean | undefined)
          | undefined;
      case "keyDown":
        return behavior.onKeyDown as
          | ((
              state: S,
              ctx: ToolContext<S, TTool>,
              event: ToolEvent,
            ) => boolean | undefined)
          | undefined;
      case "keyUp":
        return behavior.onKeyUp as
          | ((
              state: S,
              ctx: ToolContext<S, TTool>,
              event: ToolEvent,
            ) => boolean | undefined)
          | undefined;
      default:
        return undefined;
    }
  }
}
