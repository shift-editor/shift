import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { GlyphCategory, GlyphCategoryCatalog, GlyphCategorySummary } from "@shift/glyph-info";
import type { GlyphName, GlyphRecord } from "@shift/types";
import { useSignalState } from "@/lib/signals";
import { getEditor, getGlyphInfo } from "@/store/appStore";
import { ADOBE_LATIN_1 } from "@data/adobe-latin-1";

export interface GlyphCatalogItem {
  readonly name: GlyphName;
  readonly unicode: number | null;
  readonly exists: boolean;
}

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

const GlyphCatalogContext = createContext<GlyphCatalogState | null>(null);

export const GlyphCatalogProvider = ({ children }: { children: ReactNode }) => {
  const value = useGlyphCatalogState();
  return <GlyphCatalogContext.Provider value={value}>{children}</GlyphCatalogContext.Provider>;
};

export const useGlyphCatalog = (): GlyphCatalogState => {
  const ctx = useContext(GlyphCatalogContext);
  if (!ctx) throw new Error("useGlyphCatalog must be used within a GlyphCatalogProvider");
  return ctx;
};

const useGlyphCatalogState = (): GlyphCatalogState => {
  const glyphInfo = getGlyphInfo();
  const font = getEditor().font;

  const fontLoaded = useSignalState(font.$loaded);
  const glyphRecords = useSignalState(font.glyphRecordsCell);

  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<GlyphCategory | null>(null);
  const [selectedSubCategoryKey, setSelectedSubCategoryKey] = useState<string | null>(null);

  const starterUnicodes = useMemo(
    () => Object.values(ADOBE_LATIN_1).map((g) => parseInt(g.unicode, 16)),
    [],
  );

  const availableGlyphs = useMemo(
    () =>
      fontLoaded && glyphRecords.length > 0
        ? glyphRecords.map(glyphCatalogItemFromRecord)
        : starterUnicodes.map((unicode) => ({
            name: font.nameForUnicode(unicode),
            unicode,
            exists: false,
          })),
    [font, fontLoaded, glyphRecords, starterUnicodes],
  );

  const availableUnicodes = useMemo(
    () => availableGlyphs.flatMap((glyph) => (glyph.unicode === null ? [] : [glyph.unicode])),
    [availableGlyphs],
  );

  const categoryCatalog = useMemo<GlyphCategoryCatalog>(
    () => glyphInfo.createCategoryCatalog(availableUnicodes),
    [availableUnicodes, glyphInfo],
  );

  const filteredGlyphs = useMemo(() => {
    const categoryFilteredUnicodes = new Set(
      categoryCatalog.filter({
        query,
        category: selectedCategory,
        subCategoryKey: selectedSubCategoryKey,
        searchLimit: Math.max(availableUnicodes.length, 200),
      }),
    );

    const normalizedQuery = query.trim().toLowerCase();
    const filteringByCategory = selectedCategory !== null || selectedSubCategoryKey !== null;

    return availableGlyphs.filter((glyph) => {
      const unicodeMatched = glyph.unicode !== null && categoryFilteredUnicodes.has(glyph.unicode);
      const nameMatched =
        normalizedQuery !== "" && glyph.name.toLowerCase().includes(normalizedQuery);

      if (filteringByCategory) return unicodeMatched;
      if (normalizedQuery !== "") return unicodeMatched || nameMatched;
      return true;
    });
  }, [
    availableGlyphs,
    availableUnicodes.length,
    categoryCatalog,
    query,
    selectedCategory,
    selectedSubCategoryKey,
  ]);

  return {
    availableGlyphs,
    filteredGlyphs,
    categories: categoryCatalog.categories,
    query,
    selectedCategory,
    selectedSubCategoryKey,
    setQuery,
    createQuickGlyph: () => {
      const record = getEditor().createGlyph("newGlyph" as GlyphName);
      setQuery("");
      setSelectedCategory(null);
      setSelectedSubCategoryKey(null);

      return record.name;
    },
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

function glyphCatalogItemFromRecord(record: GlyphRecord): GlyphCatalogItem {
  return {
    name: record.name,
    unicode: record.unicodes[0] ?? null,
    exists: true,
  };
}
