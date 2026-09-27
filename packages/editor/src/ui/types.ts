import type { Editor } from "../lib/editor/Editor";
import type { Font } from "../lib/model/Font";

export interface EditorUISession {
  readonly mode: "preview" | "memory" | "workspace";
  readonly font: Font;
  readonly editor: Editor;
}
