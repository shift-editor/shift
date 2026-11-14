/** A search over glyph names, as the canvas's Glyphs tab takes it. */
export interface GlyphSearch {
  readonly text: string;
  /** Aa: letters match only in their own case. */
  readonly caseSensitive: boolean;
  /** `.*`: the text is a regular expression. */
  readonly regex: boolean;
}

/** A glyph as a search reads it. */
export interface SearchedGlyph {
  readonly name: string;
  readonly displayName: string;
  readonly unicode: number | null;
}

/** A search made ready to test glyphs, or why its text cannot be searched for. */
export type GlyphSearchMatcher =
  | { readonly kind: "matcher"; readonly matches: (glyph: SearchedGlyph) => boolean }
  | { readonly kind: "invalid"; readonly problem: string };

export const NO_SEARCH: GlyphSearch = { text: "", caseSensitive: false, regex: false };

/**
 * Reads a search: blank text matches every glyph; otherwise a glyph matches
 * when its name or display name contains the text, or the text is its
 * character. A regular expression is tested against both names.
 */
export function glyphSearchMatcher({
  text,
  caseSensitive,
  regex,
}: GlyphSearch): GlyphSearchMatcher {
  if (text === "") return { kind: "matcher", matches: () => true };

  if (regex) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(text, caseSensitive ? "u" : "iu");
    } catch (error) {
      const problem = error instanceof Error ? error.message : "Not a regular expression";
      return { kind: "invalid", problem };
    }
    return {
      kind: "matcher",
      matches: (glyph) => pattern.test(glyph.name) || pattern.test(glyph.displayName),
    };
  }

  const fold = (value: string) => (caseSensitive ? value : value.toLowerCase());
  const wanted = fold(text);
  return {
    kind: "matcher",
    matches: (glyph) =>
      fold(glyph.name).includes(wanted) ||
      fold(glyph.displayName).includes(wanted) ||
      (glyph.unicode !== null && String.fromCodePoint(glyph.unicode) === text),
  };
}
