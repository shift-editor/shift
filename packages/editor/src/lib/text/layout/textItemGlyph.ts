import type { GlyphEntry, GlyphName, Unicode } from "@shift/types";
import type { Font } from "../../model/Font";
import type { GlyphicTextItem } from "./types";

/** The glyph an item shows before shaping, with the name and character used to draw it. */
export interface TextItemGlyph {
  /** The committed glyph, or null when the font maps no glyph to the character or the glyph is gone. */
  readonly entry: GlyphEntry | null;
  /** The glyph's name, or the name it would take for an unmapped character. */
  readonly name: GlyphName;
  /** The typed character, or the picked glyph's first Unicode value. */
  readonly codepoint: number | null;
}

const NOTDEF = ".notdef" as GlyphName;

/**
 * Resolves an item to the glyph it shows without shaping.
 *
 * @remarks
 * A character goes through the font's Unicode mapping only, the way a shaper
 * maps it, so a glyph that merely has the conventional name is not used.
 * Reads the font without tracking; reactive callers track
 * `Font.glyphEntriesCell`.
 */
export function textItemGlyph(item: GlyphicTextItem, font: Font): TextItemGlyph {
  if (item.kind === "character") {
    const entry = font.entryForUnicode(item.codepoint as Unicode);
    return {
      entry,
      name: entry?.name ?? font.nameForUnicode(item.codepoint as Unicode),
      codepoint: item.codepoint,
    };
  }
  const entry = font.entryForId(item.glyphId);
  return { entry, name: entry?.name ?? NOTDEF, codepoint: entry?.unicodes[0] ?? null };
}
