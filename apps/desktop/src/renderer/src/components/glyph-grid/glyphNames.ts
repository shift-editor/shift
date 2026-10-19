import type { Editor } from "@shift/editor";
import type { GlyphId } from "@shift/types";
import { glyphName } from "../kerning/groups/previewGlyphs";

/**
 * Glyphs as slash names, such as `/f_i/one.tnum`: the form proof text reads
 * as picked glyphs, so pasting them back into text inserts the same glyphs.
 */
export function slashGlyphNames(editor: Editor, glyphIds: readonly GlyphId[]): string {
  return glyphIds.map((id) => `/${glyphName(editor, id)}`).join("");
}

/** Copies glyphs to the clipboard as {@link slashGlyphNames}. */
export async function copyGlyphNames(editor: Editor, glyphIds: readonly GlyphId[]): Promise<void> {
  try {
    await navigator.clipboard.writeText(slashGlyphNames(editor, glyphIds));
  } catch (error) {
    console.error("copying glyph names failed", error);
  }
}
