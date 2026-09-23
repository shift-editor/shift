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

/** Dependencies for one workspace-free editor session. */
export interface MemoryFontSessionOptions {
  readonly source: MemoryFontSource;
  readonly clipboard: SystemClipboard;
}

/** Owns one live workspace-free font and editor composition. */
export interface MemoryFontSession {
  readonly mode: "memory";
  readonly font: Font;
  readonly editor: Editor;
  dispose(): void;
}
