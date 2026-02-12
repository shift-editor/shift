import type { EditorAPI } from "./EditorAPI";
import type { ToolEvent } from "./GestureDetector";
import type { ToolName, ToolState } from "./createContext";
import type { DrawAPI } from "./DrawAPI";
import type { Behavior } from "./Behavior";
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
 * - `executeAction()` — optional handler for action side effects.
 * - `onStateChange()` — optional hook after every committed transition.
 * - `render()` / `renderBelowHandles()` — per-frame drawing on the overlay.
 *
 * @typeParam S - The tool's state union (must extend `ToolState`).
 * @typeParam A - Action type emitted by behaviors. `never` for action-free tools.
 * @typeParam Settings - Optional per-tool settings object.
 */
export abstract class BaseTool<S extends ToolState, A = never, Settings = Record<string, never>> {
  abstract readonly id: ToolName;
  /** Ordered behavior list -- first match wins on each event. */
  abstract readonly behaviors: Behavior<S, ToolEvent, A>[];
  readonly $cursor: ComputedSignal<CursorType>;
  state: S;
  settings: Settings;
  protected editor: EditorAPI;

  constructor(editor: EditorAPI) {
    this.editor = editor;
    this.state = this.initialState();
    this.settings = this.defaultSettings();
    this.$cursor = computed(() => this.getCursor(this.editor.getActiveToolState() as S));
  }

  getCursor(_state: S): CursorType {
    return { type: "default" };
  }

  get name(): ToolName {
    return this.id;
  }

  abstract initialState(): S;

  defaultSettings(): Settings {
    return {} as Settings;
  }

  /** Return a {@link TransitionResult} to short-circuit the behavior loop, or null to continue. */
  protected preTransition?(_state: S, _event: ToolEvent): { state: S; action?: A } | null;
  protected executeAction?(_action: A, _prev: S, _next: S): void;
  protected onStateChange?(_prev: S, _next: S, _event: ToolEvent): void;

  /** Draw tool-specific overlays above handles (e.g. pen preview segments). */
  render?(draw: DrawAPI): void;
  /** Draw tool-specific overlays below handles (e.g. marquee rectangle). */
  renderBelowHandles?(draw: DrawAPI): void;

  activate?(): void;
  deactivate?(): void;

  /**
   * Run the behavior loop: try `preTransition`, then each behavior in order.
   * Returns the next state (may be the same reference if nothing matched).
   * Stashes any emitted action in `#pendingAction` for `onTransition`.
   */
  transition(state: S, event: ToolEvent): S {
    this.#lastTransitionHandled = false;
    this.#pendingAction = null;

    if (state.type === "idle") {
      return state;
    }

    if (this.preTransition) {
      const result = this.preTransition(state, event);
      if (result !== null) {
        this.#lastTransitionHandled = true;
        this.#pendingAction = result.action ?? null;
        return result.state;
      }
    }

    for (const behavior of this.behaviors) {
      if (behavior.canHandle(state, event)) {
        const result = behavior.transition(state, event, this.editor);
        if (result !== null) {
          this.#lastTransitionHandled = true;
          this.#pendingAction = result.action ?? null;
          return result.state;
        }
      }
    }

    return state;
  }

  #pendingAction: A | null = null;
  #lastTransitionHandled = false;

  /**
   * Post-transition hook: executes the pending action (if any), then notifies
   * each behavior and calls `onStateChange`. Runs inside the same `batch` as
   * the state update.
   */
  onTransition(prev: S, next: S, event: ToolEvent): void {
    if (this.#pendingAction && this.executeAction) {
      this.executeAction(this.#pendingAction, prev, next);
    }

    for (const behavior of this.behaviors) {
      behavior.onTransition?.(prev, next, event, this.editor);
    }

    this.onStateChange?.(prev, next, event);
  }

  /**
   * Main entry point called by ToolManager on every gesture event.
   * Runs transition, and if the state changed, commits it in a reactive batch.
   */
  handleEvent(event: ToolEvent): boolean {
    const prev = this.state;
    const next = this.transition(this.state, event);
    const handled = this.#lastTransitionHandled;

    if (next !== prev) {
      batch(() => {
        this.state = next;
        this.editor.setActiveToolState(next);
        this.onTransition(prev, next, event);
      });
    }

    return handled;
  }

  isInState<T extends S["type"]>(...types: T[]): boolean {
    return (types as string[]).includes(this.state.type);
  }

  getState(): S {
    return this.state;
  }

  /** Execute `fn` inside a named command batch. Automatically rolls back on exception. */
  protected batch<T>(name: string, fn: () => T): T {
    this.editor.commands.beginBatch(name);
    try {
      const result = fn();
      this.editor.commands.endBatch();
      return result;
    } catch (err) {
      this.editor.commands.cancelBatch();
      throw err;
    }
  }

  protected beginPreview(): void {
    this.editor.beginPreview();
  }

  protected commitPreview(label: string): void {
    this.editor.commitPreview(label);
  }

  protected cancelPreview(): void {
    this.editor.cancelPreview();
  }
}
