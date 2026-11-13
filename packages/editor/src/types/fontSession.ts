import type { Editor } from "../lib/editor/Editor";
import type { Font } from "../lib/model/Font";
import type { SystemClipboard } from "../lib/clipboard/types";

/**
 * A whole font held in memory, for a workspace-free session: shift-font's
 * `Font` with every glyph layer, as named MessagePack, which the session's
 * engine opens as it stands. {@link newMemoryFontSource} starts one from
 * nothing.
 */
export interface MemoryFontSource {
  readonly font: Uint8Array;
}

/** Tools a workspace-free session can offer; authoring tools need a workspace. */
export type MemoryToolName = "select" | "hand";

/** What a workspace-free editor offers, whatever font it opens. */
export interface MemoryEditorOptions {
  readonly clipboard: SystemClipboard;
  /**
   * Tools shown in the toolbar, in order. The first becomes active; an empty
   * list makes the session view-only. Defaults to Select then Hand.
   */
  // oxlint-disable-next-line shift/no-optional-collection-field -- absent means Select then Hand; empty means view-only
  readonly tools?: readonly MemoryToolName[];
}

/** Dependencies for one workspace-free editor session. */
export interface MemoryFontSessionOptions extends MemoryEditorOptions {
  readonly source: MemoryFontSource;
}

/** What a new memory font is called and sized at. */
export interface NewMemoryFont {
  readonly familyName: string;
  readonly unitsPerEm: number;
}

/** Owns one live workspace-free font and editor composition. */
export interface MemoryFontSession {
  readonly mode: "memory";
  readonly font: Font;
  readonly editor: Editor;
  dispose(): void;
}
