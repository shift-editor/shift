import type { FontSnapshot, GlyphRecord } from "@shift/types";
import type { Editor } from "../lib/editor/Editor";
import type { Font } from "../lib/model/Font";
import type { SystemClipboard } from "../lib/clipboard/types";
import type { GlyphReader } from "./glyph";

/** Supplies one workspace-free font directory and its lazily loaded glyph geometry. */
export interface MemoryFontSource extends GlyphReader {
  readonly font: FontSnapshot;
  readonly records: readonly GlyphRecord[];
}

/** Tools a workspace-free session can offer; authoring tools need a workspace. */
export type MemoryToolName = "select" | "hand";

/** Dependencies for one workspace-free editor session. */
export interface MemoryFontSessionOptions {
  readonly source: MemoryFontSource;
  readonly clipboard: SystemClipboard;
  /**
   * Tools shown in the toolbar, in order. The first becomes active; an empty
   * list makes the session view-only. Defaults to Select then Hand.
   */
  readonly tools?: readonly MemoryToolName[];
}

/** Owns one live workspace-free font and editor composition. */
export interface MemoryFontSession {
  readonly mode: "memory";
  readonly font: Font;
  readonly editor: Editor;
  dispose(): void;
}
