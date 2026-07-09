import { useMemo, useState, type ReactNode } from "react";
import type { GlyphCategory, GlyphCategoryCatalog } from "@shift/glyph-info";
import type { GlyphName, GlyphRecord } from "@shift/types";
import { useSignalState } from "@/lib/signals";
import { useEditor } from "@/workspace/WorkspaceContext";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import {
  GlyphCatalogContext,
  type GlyphCatalogItem,
  type GlyphCatalogState,
} from "./GlyphCatalogContext";

export const GlyphCatalogProvider = ({ children }: { children: ReactNode }) => {
  const value = useGlyphCatalogState();
  return <GlyphCatalogContext.Provider value={value}>{children}</GlyphCatalogContext.Provider>;
};

const useGlyphCatalogState = (): GlyphCatalogState => {
  const editor = useEditor();
  const glyphInfo = getGlyphInfo();
  const font = editor.font;

  const glyphRecords = useSignalState(font.glyphRecordsCell);

  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<GlyphCategory | null>(null);
  const [selectedSubCategoryKey, setSelectedSubCategoryKey] = useState<string | null>(null);

  const availableGlyphs = useMemo(
    () => glyphRecords.map(glyphCatalogItemFromRecord),
    [glyphRecords],
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
      const record = editor.createGlyph("newGlyph" as GlyphName);
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
    id: record.id,
    name: record.name,
    unicode: record.unicodes[0] ?? null,
  };
}
