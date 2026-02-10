// TODO: Derive union types from GlyphData.xml categories once the set stabilizes.
// e.g. GlyphCategory = "Letter" | "Symbol" | "Punctuation" | "Number" | "Separator" | "Mark"
// e.g. GlyphSubCategory = "Currency" | "Math" | "Quote" | "Dash" | "Space" | "Parenthesis" | "Decimal Digit" | ...
// e.g. GlyphScript = "latin" | "cyrillic" | "greek" | "arabic" | "hebrew" | ...
// These could be auto-generated from the XML during the generate step.

export interface GlyphData {
  codepoint: number;
  name: string;
  category: string; // TODO: narrow to GlyphCategory union
  subCategory: string | null; // TODO: narrow to GlyphSubCategory union
  script: string | null; // TODO: narrow to GlyphScript union
  production: string | null;
  altNames: string | null;
}

export interface CharsetDefinition {
  id: string; // TODO: narrow to CharsetId union once more charsets are added (e.g. "adobe-latin-1" | "adobe-latin-2" | ...)
  name: string;
  source: string; // TODO: narrow to CharsetSource union (e.g. "adobe" | "google" | "custom")
  codepoints: number[];
}

export interface CharsetSummary {
  id: string;
  name: string;
  source: string;
  count: number;
}

export interface SearchResult {
  codepoint: number;
  glyphName: string | null;
  unicodeName: string | null;
  category: string | null;
  subCategory: string | null;
  rank: number;
}

export interface DecompositionData {
  decomposed: Record<string, number[]>;
  usedBy: Record<string, number[]>;
}

export interface GlyphInfoResources {
  glyphData: GlyphData[];
  decomposition: DecompositionData;
  charsets: CharsetDefinition[];
  searchData: Record<string, unknown>[];
}
