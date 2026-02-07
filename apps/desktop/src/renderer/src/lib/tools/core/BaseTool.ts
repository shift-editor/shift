import type { ToolContext } from "./ToolContext";
import type { ToolEvent } from "./GestureDetector";
import type { ToolName, ToolState } from "./createContext";
import type { DrawAPI } from "./DrawAPI";
import type { Behavior } from "./Behavior";
import { batch, computed, type ComputedSignal } from "../../reactive/signal";
import type { CursorType } from "@/types/editor";

export type { ToolName, ToolState };

export abstract class BaseTool<S extends ToolState, A = never, Settings = Record<string, never>> {
  abstract readonly id: ToolName;
  abstract readonly behaviors: Behavior<S, ToolEvent, A>[];
  readonly $cursor: ComputedSignal<CursorType>;
  state: S;
  settings: Settings;
  protected editor: ToolContext;

  constructor(editor: ToolContext) {
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

  /**
   * Override to short-circuit before behaviors run.
   * Return a TransitionResult to skip the behavior loop, or null to continue.
   */
  protected preTransition?(_state: S, _event: ToolEvent): { state: S; action?: A } | null;

  /**
   * Override to handle action side effects (for action-aware tools like Pen, Select).
   */
  protected executeAction?(_action: A, _prev: S, _next: S): void;

  /**
   * Override for tool-specific post-transition logic.
   */
  protected onStateChange?(_prev: S, _next: S, _event: ToolEvent): void;

  render?(draw: DrawAPI): void;
  renderBelowHandles?(draw: DrawAPI): void;

  activate?(): void;
  deactivate?(): void;

  transition(state: S, event: ToolEvent): S {
    if (state.type === "idle") {
      return state;
    }

    if (this.preTransition) {
      const result = this.preTransition(state, event);
      if (result !== null) {
        this.#pendingAction = result.action ?? null;
        return result.state;
      }
    }

    for (const behavior of this.behaviors) {
      if (behavior.canHandle(state, event)) {
        const result = behavior.transition(state, event, this.editor);
        if (result !== null) {
          this.#pendingAction = result.action ?? null;
          return result.state;
        }
      }
    }

    return state;
  }

  #pendingAction: A | null = null;

  onTransition(prev: S, next: S, event: ToolEvent): void {
    if (this.#pendingAction && this.executeAction) {
      this.executeAction(this.#pendingAction, prev, next);
    }

    for (const behavior of this.behaviors) {
      behavior.onTransition?.(prev, next, event, this.editor);
    }

    this.onStateChange?.(prev, next, event);
  }

  handleEvent(event: ToolEvent): void {
    const prev = this.state;
    const next = this.transition(this.state, event);

    if (next !== prev) {
      batch(() => {
        this.state = next;
        this.editor.setActiveToolState(next);
        this.onTransition(prev, next, event);
      });
    }
  }

  isInState<T extends S["type"]>(...types: T[]): boolean {
    return (types as string[]).includes(this.state.type);
  }

  getState(): S {
    return this.state;
  }

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
