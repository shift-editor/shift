import type { EditorAPI } from "./EditorAPI";
import type { ToolEvent } from "./GestureDetector";
import type { ToolName, ToolState } from "./createContext";
import type { DrawAPI } from "./DrawAPI";
import type { Behavior, ToolContext } from "./Behavior";
import { batch, computed, type ComputedSignal } from "../../reactive/signal";
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
 * - `render()` / `renderBelowHandles()` — per-frame drawing on the overlay.
 *
 * @typeParam S - The tool's state union (must extend `ToolState`).
 * @typeParam Settings - Optional per-tool settings object.
 */
export abstract class BaseTool<S extends ToolState, Settings = Record<string, never>> {
  abstract readonly id: ToolName;
  /** Ordered behavior list -- first match wins on each event. */
  abstract readonly behaviors: Behavior<S>[];
  readonly $cursor: ComputedSignal<CursorType>;
  state: S;
  /** @knipclassignore */
  settings: Settings;
  protected editor: EditorAPI;

  constructor(editor: EditorAPI) {
    this.editor = editor;
    this.state = this.initialState();
    this.settings = this.defaultSettings();
    this.$cursor = computed(() => this.getCursor(this.editor.getActiveToolState() as S));
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

  /** Draw in viewport (scene) space, before the editable glyph. Used for text runs. */
  renderInScene?(draw: DrawAPI): void;
  /** Draw tool-specific overlays above handles (e.g. pen preview segments). */
  render?(draw: DrawAPI): void;
  /** Draw tool-specific overlays below handles (e.g. marquee rectangle). */
  renderBelowHandles?(draw: DrawAPI): void;

  activate?(): void;
  deactivate?(): void;

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
          if (behavior.onStateExit) behavior.onStateExit(prev, next, preCommitContext, event);
        }

        this.state = next;
        this.editor.setActiveToolState(next);

        const postCommitContext = this.#createContext(
          () => this.state,
          (nextState: S) => {
            this.state = nextState;
          },
        );
        for (const behavior of this.behaviors) {
          if (behavior.onStateEnter) behavior.onStateEnter(prev, next, postCommitContext, event);
        }

        if (this.onStateChange) this.onStateChange(prev, next, event);
      });
    }

    return result.handled;
  }

  getState(): S {
    return this.state;
  }

  /** Execute `fn` inside a named command batch. Automatically rolls back on exception. */
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
        const handled = handler.call(behavior, nextState, dispatchContext, event as never);
        if (handled) {
          return { state: nextState, handled: true };
        }
      }
    }

    return { state: nextState, handled: false };
  }

  #createContext(getState: () => S, setState: (next: S) => void): ToolContext<S> {
    return {
      editor: this.editor,
      getState,
      setState,
    };
  }

  #getEventHandler(
    behavior: Behavior<S>,
    type: ToolEvent["type"],
  ): ((state: S, ctx: ToolContext<S>, event: ToolEvent) => boolean | undefined) | undefined {
    switch (type) {
      case "pointerMove":
        return behavior.onPointerMove as
          | ((state: S, ctx: ToolContext<S>, event: ToolEvent) => boolean | undefined)
          | undefined;
      case "click":
        return behavior.onClick as
          | ((state: S, ctx: ToolContext<S>, event: ToolEvent) => boolean | undefined)
          | undefined;
      case "doubleClick":
        return behavior.onDoubleClick as
          | ((state: S, ctx: ToolContext<S>, event: ToolEvent) => boolean | undefined)
          | undefined;
      case "dragStart":
        return behavior.onDragStart as
          | ((state: S, ctx: ToolContext<S>, event: ToolEvent) => boolean | undefined)
          | undefined;
      case "drag":
        return behavior.onDrag as
          | ((state: S, ctx: ToolContext<S>, event: ToolEvent) => boolean | undefined)
          | undefined;
      case "dragEnd":
        return behavior.onDragEnd as
          | ((state: S, ctx: ToolContext<S>, event: ToolEvent) => boolean | undefined)
          | undefined;
      case "dragCancel":
        return behavior.onDragCancel as
          | ((state: S, ctx: ToolContext<S>, event: ToolEvent) => boolean | undefined)
          | undefined;
      case "keyDown":
        return behavior.onKeyDown as
          | ((state: S, ctx: ToolContext<S>, event: ToolEvent) => boolean | undefined)
          | undefined;
      case "keyUp":
        return behavior.onKeyUp as
          | ((state: S, ctx: ToolContext<S>, event: ToolEvent) => boolean | undefined)
          | undefined;
      default:
        return undefined;
    }
  }
}
