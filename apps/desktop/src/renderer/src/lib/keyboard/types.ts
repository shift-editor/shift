import type { CommandId } from "@shared/commands";
import type { Editor } from "@shift/editor";
import type { ToolName } from "@shift/editor/tools";

export type KeyboardEditorActions = Editor;

export interface KeyboardToolManagerActions {
  handleKeyDown(e: KeyboardEvent): boolean;
  handleKeyUp(e: KeyboardEvent): boolean;
}

/** Dispatches an application command matched by the renderer keyboard router. */
export type KeyboardCommandHandler = (id: CommandId) => void | Promise<void>;

export interface KeyContext {
  canvasActive: boolean;
  activeTool: ToolName | null;
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
  run: (ctx: KeyContext, e: KeyboardEvent) => boolean | Promise<boolean>;
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
