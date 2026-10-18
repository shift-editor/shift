import type { GlyphName } from "@shift/types";
import type { TextItem } from "../layout";
import { PlainTextParser } from "./PlainTextParser";
import type { TextParseContext, TextParser } from "./TextParser";

/** A slash and a name, up to the next slash or whitespace. */
const GLYPH_NAME = /\/([^/\s]+)/g;

/**
 * Parses plain text where `/name` picks a glyph by name.
 *
 * @remarks
 * A slash alone, or one before a name the font lacks, is a literal
 * character. Names end at whitespace or the next slash, so `/a/b` picks two
 * glyphs.
 */
export class GlyphNameParser implements TextParser {
  readonly #plain = new PlainTextParser();

  parse(source: string, context: TextParseContext): TextItem[] {
    const items: TextItem[] = [];
    let plainStart = 0;
    for (const match of source.matchAll(GLYPH_NAME)) {
      const picked = context.glyphNamed(match[1] as GlyphName);
      if (!picked) continue;
      items.push(...this.#plain.parse(source.slice(plainStart, match.index)), picked);
      plainStart = match.index + match[0].length;
    }
    items.push(...this.#plain.parse(source.slice(plainStart)));
    return items;
  }
}
