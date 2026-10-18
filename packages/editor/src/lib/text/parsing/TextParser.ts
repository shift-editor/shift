import type { GlyphName } from "@shift/types";
import type { TextItem } from "../layout";

/**
 * Turns typed or pasted text into text items.
 *
 * @remarks
 * The editor uses one parser for all text input (`Text.parser`); implement
 * this to add a syntax, such as escapes or commands that pick glyphs.
 */
export interface TextParser {
  parse(source: string, context: TextParseContext): TextItem[];
}

/** What a parser can ask of the font it parses for. */
export interface TextParseContext {
  /** Returns the item that shows a named glyph; null when the font has no glyph with that name. */
  glyphNamed(name: GlyphName): TextItem | null;
}
