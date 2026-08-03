import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import type { GlyphCategory, GlyphCategoryCatalog } from "@shift/glyph-info";
import type { GlyphName } from "@shift/types";
import { effect, useSignalState } from "@/lib/signals";
import { useFontSession } from "@/workspace/WorkspaceContext";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { GlyphCatalogContext } from "./GlyphCatalogContext";
import type { GlyphCatalogItem, GlyphCatalogState } from "@/types/glyphCatalog";

export const GlyphCatalogProvider = ({ children }: { children: ReactNode }) => {
  const value = useGlyphCatalogState();
  return <GlyphCatalogContext.Provider value={value}>{children}</GlyphCatalogContext.Provider>;
};

const useGlyphCatalogState = (): GlyphCatalogState => {
  const session = useFontSession();
  const navigate = useNavigate();
  const glyphInfo = getGlyphInfo();
  const catalog = session.catalog;
  const workspace = session.workspace;

  const availableGlyphs = useSignalState(catalog.glyphsCell);
  const location = useSignalState(catalog.locationCell);
  const axes = useSignalState(catalog.axesCell);
  const metrics = useSignalState(catalog.metricsCell);
  const sourceId = useSignalState(catalog.sourceIdCell);
  const observeAtlasInvalidation = useCallback<GlyphCatalogState["observeAtlasInvalidation"]>(
    (listener) => {
      const subscription = effect(
        () => listener(catalog.invalidGlyphKeysCell.value, catalog.glyphsCell.value.map(glyphKey)),
        { name: "glyphCatalog.atlas" },
      );
      return () => subscription.dispose();
    },
    [catalog],
  );

  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<GlyphCategory | null>(null);
  const [selectedSubCategoryKey, setSelectedSubCategoryKey] = useState<string | null>(null);

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
        normalizedQuery !== "" &&
        (glyph.name.toLowerCase().includes(normalizedQuery) ||
          glyph.displayName.toLowerCase().includes(normalizedQuery));

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

  const openGlyph = useMemo<GlyphCatalogState["openGlyph"]>(() => {
    if (!workspace) return null;

    return async (glyph) => {
      if (typeof glyph.id !== "string") throw new Error("authored catalog received a glyph index");
      await workspace.font.loadGlyph(glyph.id);
      navigate(`/editor/${encodeURIComponent(glyph.id)}`);
    };
  }, [navigate, workspace]);

  const createQuickGlyph = useCallback<GlyphCatalogState["createQuickGlyph"]>(() => {
    if (!workspace) throw new Error("preview catalog cannot create glyphs");

    const record = workspace.editor.createGlyph("newGlyph" as GlyphName);
    setQuery("");
    setSelectedCategory(null);
    setSelectedSubCategoryKey(null);
    return record.name;
  }, [workspace]);

  return {
    availableGlyphs: [...availableGlyphs],
    filteredGlyphs,
    categories: categoryCatalog.categories,
    query,
    selectedCategory,
    selectedSubCategoryKey,
    setQuery,
    atlasSource: catalog.atlas,
    observeAtlasInvalidation,
    location,
    axes,
    metrics,
    sourceId,
    editable: workspace !== null,
    openGlyph,
    createQuickGlyph,
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

function glyphKey(glyph: GlyphCatalogItem) {
  return glyph.id;
}
