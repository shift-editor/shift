import type { Editor } from "@shift/editor";
import type { GlyphId } from "@shift/types";
import { glyphTextItem } from "@shift/editor/text";

/**
 * Glyphs as slash names, such as `/f_i/one.tnum`: the form proof text reads
 * as picked glyphs, so pasting them back into text inserts the same glyphs.
 * Written by shift-font's `ProofText` (`Text.formatItems`).
 */
export function slashGlyphNames(editor: Editor, glyphIds: readonly GlyphId[]): string {
  return editor.text.formatItems(glyphIds.map((id) => glyphTextItem(id)));
}

/** Copies glyphs to the clipboard as {@link slashGlyphNames}. */
export async function copyGlyphNames(editor: Editor, glyphIds: readonly GlyphId[]): Promise<void> {
  try {
    await navigator.clipboard.writeText(slashGlyphNames(editor, glyphIds));
  } catch (error) {
    console.error("copying glyph names failed", error);
  }
}
