import type { ToolName } from "@/lib/tools/core";

export interface TemporaryToolOptions {
  onActivate?: () => void;
  onReturn?: () => void;
}

export interface ToolSwitchHandler {
  requestTemporary: (toolId: ToolName, options?: TemporaryToolOptions) => void;
  returnFromTemporary: () => void;
}

export class ToolsService {
  #handler: ToolSwitchHandler | null = null;

  setHandler(handler: ToolSwitchHandler): void {
    this.#handler = handler;
  }

  requestTemporary(toolId: ToolName, options?: TemporaryToolOptions): void {
    this.#handler?.requestTemporary(toolId, options);
  }

  returnFromTemporary(): void {
    this.#handler?.returnFromTemporary();
  }
}
