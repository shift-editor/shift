import type { ToolName } from "@/lib/tools/core";
import type { ToolShortcutEntry } from "@/types/tools";

export interface KeyboardEditorActions {
  zoomIn(): void;
  zoomOut(): void;
  requestRedraw(): void;
  copy(): void;
  cut(): void;
  paste(): void;
  undo(): void;
  redo(): void;
  selectAll(): void;
  deleteSelectedPoints(): void;
  setActiveTool(toolName: ToolName): void;
  getToolShortcuts(): ToolShortcutEntry[];
  requestTemporaryTool(
    toolId: ToolName,
    options?: { onActivate?: () => void; onReturn?: () => void },
  ): void;
  returnFromTemporaryTool(): void;
  isPreviewMode(): boolean;
  setPreviewMode(enabled: boolean): void;
  insertTextCodepoint(codepoint: number): void;
  recomputeTextRun(): void;
  getTextRunCodepoints(): number[];
}

export interface KeyboardToolManagerActions {
  handleKeyDown(e: KeyboardEvent): boolean;
  handleKeyUp(e: KeyboardEvent): boolean;
}

export interface KeyContext {
  canvasActive: boolean;
  activeTool: ToolName;
  editor: KeyboardEditorActions;
  toolManager: KeyboardToolManagerActions;
}

export interface NormalizedKeyboardEvent {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  primaryModifier: boolean;
}

export interface KeyBinding {
  id: string;
  match: (event: NormalizedKeyboardEvent, ctx: KeyContext) => boolean;
  run: (ctx: KeyContext, e: KeyboardEvent) => boolean;
  preventDefault?: boolean;
  when?: (ctx: KeyContext) => boolean;
}

export interface KeyChord {
  key?: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  primaryModifier?: boolean;
}
