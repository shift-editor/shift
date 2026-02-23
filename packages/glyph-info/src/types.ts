// TODO: Derive GlyphSubCategory and GlyphScript unions from GlyphData.xml during the generate step.

/** Known Unicode general categories used for glyph classification. */
export const GLYPH_CATEGORIES = [
  "Letter",
  "Mark",
  "Number",
  "Punctuation",
  "Separator",
  "Symbol",
  "Other",
] as const;

export type GlyphCategory = (typeof GLYPH_CATEGORIES)[number];

export interface GlyphData {
  codepoint: number;
  name: string;
  category: GlyphCategory;
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
  category: GlyphCategory | null;
  subCategory: string | null;
  rank: number;
}

export interface GlyphCategoryOptions {
  includeUnknown?: boolean;
  unknownCategoryLabel?: string;
  nullSubCategoryKey?: string;
  nullSubCategoryLabel?: string;
}

export interface GlyphCodepointCategory {
  category: GlyphCategory;
  subCategoryKey: string;
  subCategoryLabel: string;
  isKnown: boolean;
}

export interface GlyphSubCategorySummary {
  key: string;
  label: string;
  count: number;
}

export interface GlyphCategorySummary {
  category: GlyphCategory;
  count: number;
  subCategories: GlyphSubCategorySummary[];
}

export interface GlyphCodepointFilter {
  category?: GlyphCategory | null;
  subCategoryKey?: string | null;
  query?: string;
  searchLimit?: number;
}

export interface GlyphCategoryCatalog {
  categories: GlyphCategorySummary[];
  filter(filter?: GlyphCodepointFilter): number[];
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
