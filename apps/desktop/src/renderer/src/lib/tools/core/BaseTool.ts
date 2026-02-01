import type { Editor } from "@/lib/editor";
import type { ToolEvent } from "./GestureDetector";
import type { ToolName } from "./createContext";
import type { DrawAPI } from "./DrawAPI";
import type { ComputedSignal } from "../../reactive/signal";
import type { CursorType } from "@/types/editor";

export type { ToolName };

export interface ToolState {
  type: string;
}

export abstract class BaseTool<S extends ToolState, Settings = Record<string, never>> {
  abstract readonly id: ToolName;
  abstract readonly $cursor: ComputedSignal<CursorType>;
  state: S;
  settings: Settings;
  protected editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
    this.state = this.initialState();
    this.settings = this.defaultSettings();
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
      this.state = next;
      this.editor.setActiveToolState(next);
      this.onTransition?.(prev, next, event);
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
    this.editor.preview.beginPreview();
  }

  protected commitPreview(label: string): void {
    this.editor.preview.commitPreview(label);
  }

  protected cancelPreview(): void {
    this.editor.preview.cancelPreview();
  }
}
