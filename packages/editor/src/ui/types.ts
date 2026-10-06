import type { Editor } from "../lib/editor/Editor";
import type { Font } from "../lib/model/Font";

/**
 * Font and editor pair that the shared UI components read and drive.
 *
 * @remarks
 * A memory session from `createMemoryFontSession` satisfies this. `mode`
 * decides which edits the UI offers: memory sessions omit workspace-backed
 * actions such as metric edits.
 */
export interface EditorUISession {
  readonly mode: "preview" | "memory" | "workspace";
  readonly font: Font;
  readonly editor: Editor;
}

/** A glyph metric the glyph sidebar edits: the advance width or one sidebearing. */
export type GlyphMetric = "advance" | "left" | "right";
