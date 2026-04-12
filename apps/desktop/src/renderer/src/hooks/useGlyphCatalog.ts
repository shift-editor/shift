import { useMemo, useState } from "react";
import type { GlyphCategory, GlyphCategoryCatalog, GlyphCategorySummary } from "@shift/glyph-info";
import { useSignalState } from "@/lib/reactive";
import { getEditor } from "@/store/store";
import { getGlyphInfo } from "@/store/glyphInfo";
import { ADOBE_LATIN_1 } from "@data/adobe-latin-1";

export interface GlyphCatalogState {
  availableUnicodes: number[];
  filteredUnicodes: number[];
  categories: GlyphCategorySummary[];
  selectedCategory: GlyphCategory | null;
  selectedSubCategoryKey: string | null;
  query: string;
  setQuery: (nextQuery: string) => void;
  selectAll: () => void;
  selectCategory: (category: GlyphCategory) => void;
  selectSubCategory: (category: GlyphCategory, subCategoryKey: string) => void;
}

export const useGlyphCatalog = (): GlyphCatalogState => {
  const glyphInfo = getGlyphInfo();
  const engine = getEditor().bridge;
  const fontLoaded = useSignalState(engine.$fontLoaded);
  const fontUnicodes = useSignalState(engine.$fontUnicodes);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<GlyphCategory | null>(null);
  const [selectedSubCategoryKey, setSelectedSubCategoryKey] = useState<string | null>(null);

  const availableUnicodes = useMemo(() => {
    if (fontLoaded) {
      return fontUnicodes;
    }

    return Object.values(ADOBE_LATIN_1).map((g) => parseInt(g.unicode, 16));
  }, [fontLoaded, fontUnicodes]);

  const categoryCatalog = useMemo<GlyphCategoryCatalog>(
    () => glyphInfo.createCategoryCatalog(availableUnicodes),
    [availableUnicodes, glyphInfo],
  );

  const categories = categoryCatalog.categories;

  const filteredUnicodes = useMemo(
    () =>
      categoryCatalog.filter({
        query,
        category: selectedCategory,
        subCategoryKey: selectedSubCategoryKey,
        searchLimit: Math.max(availableUnicodes.length, 200),
      }),
    [availableUnicodes.length, categoryCatalog, query, selectedCategory, selectedSubCategoryKey],
  );

  const selectAll = () => {
    setSelectedCategory(null);
    setSelectedSubCategoryKey(null);
  };

  const selectCategory = (category: GlyphCategory) => {
    setSelectedCategory(category);
    setSelectedSubCategoryKey(null);
  };

  const selectSubCategory = (category: GlyphCategory, subCategoryKey: string) => {
    setSelectedCategory(category);
    setSelectedSubCategoryKey(subCategoryKey);
  };

  return {
    availableUnicodes,
    filteredUnicodes,
    categories,
    query,
    selectedCategory,
    selectedSubCategoryKey,
    setQuery,
    selectAll,
    selectCategory,
    selectSubCategory,
  };
};
