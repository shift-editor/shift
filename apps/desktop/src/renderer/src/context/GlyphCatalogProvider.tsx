import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import type { GlyphCategory, GlyphCategoryCatalog, GlyphInfo } from "@shift/glyph-info";
import type { GlyphName, GlyphRecord } from "@shift/types";
import { effect, useSignalState } from "@/lib/signals";
import { useEditor } from "@/workspace/WorkspaceContext";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { GlyphCatalogContext } from "./GlyphCatalogContext";
import type { GlyphCatalogItem, GlyphCatalogState } from "@/types/glyphCatalog";
import { AuthoredGlyphAtlasSource } from "@/lib/graphics/backends/AuthoredGlyphAtlasSource";

export const GlyphCatalogProvider = ({ children }: { children: ReactNode }) => {
  const value = useGlyphCatalogState();
  return <GlyphCatalogContext.Provider value={value}>{children}</GlyphCatalogContext.Provider>;
};

const useGlyphCatalogState = (): GlyphCatalogState => {
  const editor = useEditor();
  const navigate = useNavigate();
  const glyphInfo = getGlyphInfo();
  const font = editor.font;

  const glyphRecords = useSignalState(font.glyphRecordsCell);
  const location = useSignalState(editor.designLocationCell);
  const atlasSource = useMemo(
    () => new AuthoredGlyphAtlasSource(font.editCoordinator),
    [font.editCoordinator],
  );
  const observeAtlasInvalidation = useCallback<GlyphCatalogState["observeAtlasInvalidation"]>(
    (listener) => {
      const subscription = effect(
        () =>
          listener(
            font.invalidGlyphIdsCell.value,
            font.glyphRecords().map((glyph) => glyph.id),
          ),
        { name: "glyphCatalog.authoredAtlas" },
      );
      return () => subscription.dispose();
    },
    [font],
  );

  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<GlyphCategory | null>(null);
  const [selectedSubCategoryKey, setSelectedSubCategoryKey] = useState<string | null>(null);

  const availableGlyphs = useMemo(
    () => glyphRecords.map((record) => glyphCatalogItemFromRecord(record, glyphInfo)),
    [glyphInfo, glyphRecords],
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

  const metrics = useMemo(() => font.metricsAtLocation(location), [font, location]);
  const axes = font.getAxes();
  const sourceId = font.sourceAt(location)?.id ?? null;
  const openGlyph = useCallback(
    async (glyph: GlyphCatalogItem) => {
      if (typeof glyph.id !== "string") throw new Error("authored catalog received a glyph index");
      await font.loadGlyph(glyph.id);
      navigate(`/editor/${encodeURIComponent(glyph.id)}`);
    },
    [font, navigate],
  );

  return {
    availableGlyphs,
    filteredGlyphs,
    categories: categoryCatalog.categories,
    query,
    selectedCategory,
    selectedSubCategoryKey,
    setQuery,
    atlasSource,
    observeAtlasInvalidation,
    location,
    axes,
    resolvedCoordinates: null,
    metrics,
    sourceId,
    editable: true,
    openGlyph,
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

function glyphCatalogItemFromRecord(record: GlyphRecord, glyphInfo: GlyphInfo): GlyphCatalogItem {
  const unicode = record.unicodes[0] ?? null;

  return {
    id: record.id,
    name: record.name,
    displayName: glyphInfo.resolveGlyphName(record.name, unicode),
    unicode,
  };
}
