import { createContext, useContext } from "react";
import type { GlyphCategory, GlyphCategorySummary } from "@shift/glyph-info";
import type { GlyphId, GlyphName } from "@shift/types";

export type GlyphCatalogItem = {
  readonly id: GlyphId;
  readonly name: GlyphName;
  readonly unicode: number | null;
};

export interface GlyphCatalogState {
  availableGlyphs: GlyphCatalogItem[];
  filteredGlyphs: GlyphCatalogItem[];
  categories: GlyphCategorySummary[];
  selectedCategory: GlyphCategory | null;
  selectedSubCategoryKey: string | null;
  query: string;
  setQuery: (nextQuery: string) => void;
  createQuickGlyph: () => GlyphName;
  selectAll: () => void;
  selectCategory: (category: GlyphCategory) => void;
  selectSubCategory: (category: GlyphCategory, subCategoryKey: string) => void;
}

export const GlyphCatalogContext = createContext<GlyphCatalogState | null>(null);

export const useGlyphCatalog = (): GlyphCatalogState => {
  const ctx = useContext(GlyphCatalogContext);
  if (!ctx) throw new Error("useGlyphCatalog must be used within a GlyphCatalogProvider");
  return ctx;
};
