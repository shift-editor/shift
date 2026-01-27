import type { IRenderer } from "@/types/graphics";
import type { ToolEvent } from "./GestureDetector";
import type { ToolContext, ToolName } from "./createContext";

export type { ToolName };

export interface ToolState {
  type: string;
}

export abstract class BaseTool<S extends ToolState, Settings = Record<string, never>> {
  abstract readonly id: ToolName;
  state: S;
  settings: Settings;
  protected ctx: ToolContext;

  constructor(ctx: ToolContext) {
    this.ctx = ctx;
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
  render?(renderer: IRenderer): void;

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
      this.onTransition?.(prev, next, event);
      this.ctx.render.requestRedraw();
    }
  }

  isInState<T extends S["type"]>(...types: T[]): boolean {
    return (types as string[]).includes(this.state.type);
  }

  getState(): S {
    return this.state;
  }

  protected batch<T>(name: string, fn: () => T): T {
    this.ctx.commands.beginBatch(name);
    try {
      const result = fn();
      this.ctx.commands.endBatch();
      return result;
    } catch (err) {
      this.ctx.commands.cancelBatch();
      throw err;
    }
  }

  protected beginPreview(): void {
    this.ctx.preview.beginPreview();
  }

  protected commitPreview(label: string): void {
    this.ctx.preview.commitPreview(label);
  }

  protected cancelPreview(): void {
    this.ctx.preview.cancelPreview();
  }
}
