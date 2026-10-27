import { describe, expect, it } from "vitest";
import type { GlyphId, GlyphName } from "@shift/types";
import { glyphTextItem, type TextItem } from "../layout/types";
import { GlyphNameParser } from "./GlyphNameParser";
import { PlainTextParser } from "./PlainTextParser";
import type { TextParseContext, TextParser } from "./TextParser";

/** A font with only the named glyphs, each picked by an id equal to its name. */
function fontWith(...names: string[]): TextParseContext {
  return {
    glyphNamed: (name: GlyphName) =>
      names.includes(name) ? glyphTextItem(name as unknown as GlyphId) : null,
  };
}

/** Reads items back as text, with picked glyphs as `[name]`. */
function read(items: readonly TextItem[]): string {
  return items
    .map((item) => {
      if (item.kind === "linebreak") return "\n";
      return item.kind === "character" ? String.fromCodePoint(item.codepoint) : `[${item.glyphId}]`;
    })
    .join("");
}

describe("plain text parsing", () => {
  it("reads characters by code point and lines on any line ending", () => {
    const parser: TextParser = new PlainTextParser();
    expect(read(parser.parse("a/😀\r\nb", fontWith("a")))).toBe("a/😀\nb");
  });
});

describe("glyph name parsing", () => {
  const parser = new GlyphNameParser();

  it("picks glyphs by name, ending names at a slash or whitespace", () => {
    expect(read(parser.parse("x/a/b c", fontWith("a", "b")))).toBe("x[a][b] c");
  });

  it("keeps a slash literal when the font lacks the name or none follows", () => {
    expect(read(parser.parse("/zz / //a", fontWith("a")))).toBe("/zz / /[a]");
  });
});
