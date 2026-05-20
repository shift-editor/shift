import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  GlyphCategory,
  GlyphCategoryCatalog,
  GlyphCategorySummary,
} from "@shift/glyph-info";
import { useSignalState } from "@/lib/signals";
import { getEditor, getGlyphInfo } from "@/store/store";
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

const GlyphCatalogContext = createContext<GlyphCatalogState | null>(null);

export const GlyphCatalogProvider = ({ children }: { children: ReactNode }) => {
  const value = useGlyphCatalogState();
  return (
    <GlyphCatalogContext.Provider value={value}>
      {children}
    </GlyphCatalogContext.Provider>
  );
};

export const useGlyphCatalog = (): GlyphCatalogState => {
  const ctx = useContext(GlyphCatalogContext);
  if (!ctx)
    throw new Error(
      "useGlyphCatalog must be used within a GlyphCatalogProvider",
    );
  return ctx;
};

const useGlyphCatalogState = (): GlyphCatalogState => {
  const glyphInfo = getGlyphInfo();
  const font = getEditor().font;
  const fontLoaded = useSignalState(font.$loaded);
  const fontUnicodes = useSignalState(font.$unicodes);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] =
    useState<GlyphCategory | null>(null);
  const [selectedSubCategoryKey, setSelectedSubCategoryKey] = useState<
    string | null
  >(null);

  const starterUnicodes = useMemo(
    () => Object.values(ADOBE_LATIN_1).map((g) => parseInt(g.unicode, 16)),
    [],
  );
  const availableUnicodes = useMemo(
    () =>
      fontLoaded && fontUnicodes.length > 0 ? fontUnicodes : starterUnicodes,
    [fontLoaded, fontUnicodes, starterUnicodes],
  );

  const categoryCatalog = useMemo<GlyphCategoryCatalog>(
    () => glyphInfo.createCategoryCatalog(availableUnicodes),
    [availableUnicodes, glyphInfo],
  );

  const filteredUnicodes = useMemo(
    () =>
      categoryCatalog.filter({
        query,
        category: selectedCategory,
        subCategoryKey: selectedSubCategoryKey,
        searchLimit: Math.max(availableUnicodes.length, 200),
      }),
    [
      availableUnicodes.length,
      categoryCatalog,
      query,
      selectedCategory,
      selectedSubCategoryKey,
    ],
  );

  return {
    availableUnicodes,
    filteredUnicodes,
    categories: categoryCatalog.categories,
    query,
    selectedCategory,
    selectedSubCategoryKey,
    setQuery,
    selectAll: () => {
      setSelectedCategory(null);
      setSelectedSubCategoryKey(null);
    },
    selectCategory: (category) => {
      setSelectedCategory(category);
      setSelectedSubCategoryKey(null);
    },
    selectSubCategory: (category, subCategoryKey) => {
      setSelectedCategory(category);
      setSelectedSubCategoryKey(subCategoryKey);
    },
  };
};
