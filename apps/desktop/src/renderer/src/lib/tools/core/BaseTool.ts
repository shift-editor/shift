import type { ToolContext } from "./ToolContext";
import type { ToolEvent } from "./GestureDetector";
import type { ToolName, ToolState } from "./createContext";
import type { DrawAPI } from "./DrawAPI";
import { batch, computed, type ComputedSignal } from "../../reactive/signal";
import type { CursorType } from "@/types/editor";

export type { ToolName, ToolState };

export abstract class BaseTool<S extends ToolState, Settings = Record<string, never>> {
  abstract readonly id: ToolName;
  readonly $cursor: ComputedSignal<CursorType>;
  state: S;
  settings: Settings;
  protected editor: ToolContext;

  constructor(editor: ToolContext) {
    this.editor = editor;
    this.state = this.initialState();
    this.settings = this.defaultSettings();
    this.$cursor = computed(() => this.getCursor(this.editor.activeToolState.value as S));
  }

  getCursor(_state: S): CursorType {
    return { type: "default" };
  }

  get name(): ToolName {
    return this.id;
  }

  abstract initialState(): S;
  abstract transition(state: S, event: ToolEvent): S;

  defaultSettings(): Settings {
    return {} as Settings;
  }

  onTransition?(prev: S, next: S, event: ToolEvent): void;
  render?(draw: DrawAPI): void;
  renderBelowHandles?(draw: DrawAPI): void;

  activate?(): void;
  deactivate?(): void;

  handleModifier(_key: string, _pressed: boolean): boolean {
    return false;
  }

  handleEvent(event: ToolEvent): void {
    const prev = this.state;
    const next = this.transition(this.state, event);

    if (next !== prev) {
      batch(() => {
        this.state = next;
        this.editor.setActiveToolState(next);
        this.onTransition?.(prev, next, event);
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
