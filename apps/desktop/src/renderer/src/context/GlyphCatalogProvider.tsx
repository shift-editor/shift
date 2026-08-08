import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import type { GlyphCategory, GlyphCategoryCatalog } from "@shift/glyph-info";
import { asGlyphId, type GlyphId, type GlyphName } from "@shift/types";
import { effect, useSignalState } from "@/lib/signals";
import { useFontSession } from "@/workspace/WorkspaceContext";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { GlyphCatalogContext } from "./GlyphCatalogContext";
import type { GlyphCatalogItem, GlyphCatalogSource } from "@/types/glyphCatalog";

export const GlyphCatalogProvider = ({ children }: { children: ReactNode }) => {
  const value = useGlyphCatalogSource();
  return <GlyphCatalogContext.Provider value={value}>{children}</GlyphCatalogContext.Provider>;
};

const useGlyphCatalogSource = (): GlyphCatalogSource => {
  const session = useFontSession();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const routeLocation = useLocation();
  const glyphInfo = getGlyphInfo();
  const catalog = session.catalog;
  const canAuthor = session.canAuthor;
  const workspace = session.workspace;

  const availableGlyphs = useSignalState(catalog.glyphsCell);
  const location = useSignalState(catalog.locationCell);
  const axes = useSignalState(catalog.axesCell);
  const metrics = useSignalState(catalog.metricsCell);
  const sourceId = useSignalState(catalog.sourceIdCell);
  const [openedGlyph, setOpenedGlyph] = useState<GlyphCatalogSource["openedGlyph"]>(null);
  const openedGlyphKeyRef = useRef<GlyphCatalogItem["id"] | null>(null);
  const openGenerationRef = useRef(0);
  const observeAtlasInvalidation = useCallback<GlyphCatalogSource["observeAtlasInvalidation"]>(
    (listener) => {
      const subscription = effect(
        () => listener(catalog.invalidGlyphIdsCell.value, catalog.glyphsCell.value.map(glyphId)),
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

  const openGlyph = useCallback<GlyphCatalogSource["openGlyph"]>(
    async (glyph) => {
      const generation = openGenerationRef.current + 1;
      openGenerationRef.current = generation;
      openedGlyphKeyRef.current = glyph.id;
      const renderGlyph = await catalog.openGlyph(glyph.id);
      if (openGenerationRef.current !== generation) return;

      setOpenedGlyph(renderGlyph);
      navigateRef.current(`/editor/${encodeURIComponent(glyph.id)}`);
    },
    [catalog],
  );

  useEffect(() => {
    const sourceGlyphId = glyphIdFromPath(routeLocation.pathname);
    if (sourceGlyphId === null) {
      if (routeLocation.pathname.startsWith("/editor/")) {
        openedGlyphKeyRef.current = null;
        setOpenedGlyph(null);
      }
      return;
    }
    if (!availableGlyphs.some((glyph) => glyph.id === sourceGlyphId)) {
      openedGlyphKeyRef.current = null;
      setOpenedGlyph(null);
      return;
    }
    const glyphId = sourceGlyphId;
    if (openedGlyphKeyRef.current === glyphId) return;

    openedGlyphKeyRef.current = glyphId;
    const generation = openGenerationRef.current + 1;
    openGenerationRef.current = generation;
    let active = true;

    async function openRouteGlyph(): Promise<void> {
      try {
        const renderGlyph = await catalog.openGlyph(glyphId);
        if (!active || openGenerationRef.current !== generation) return;

        setOpenedGlyph(renderGlyph);
      } catch (error) {
        console.error("failed to open route glyph", error);
      }
    }

    void openRouteGlyph();
    return () => {
      active = false;
    };
  }, [availableGlyphs, catalog, routeLocation.pathname]);

  useEffect(() => {
    const openedGlyphId = openedGlyphKeyRef.current;
    if (openedGlyphId === null) return;
    const glyphId = openedGlyphId;

    const generation = openGenerationRef.current + 1;
    openGenerationRef.current = generation;
    let active = true;

    async function refreshOpenedGlyph(): Promise<void> {
      try {
        const renderGlyph = await catalog.openGlyph(glyphId);
        if (!active || openGenerationRef.current !== generation) return;

        setOpenedGlyph(renderGlyph);
      } catch (error) {
        console.error("failed to refresh opened glyph", error);
      }
    }

    void refreshOpenedGlyph();
    return () => {
      active = false;
    };
  }, [catalog, location]);

  const createQuickGlyph = useCallback<GlyphCatalogSource["createQuickGlyph"]>(() => {
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
    canAuthor,
    openedGlyph,
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

function glyphId(glyph: GlyphCatalogItem) {
  return glyph.id;
}

function glyphIdFromPath(pathname: string): GlyphId | null {
  const prefix = "/editor/";
  if (!pathname.startsWith(prefix)) return null;

  let value: string;
  try {
    value = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }

  return value.length > 0 ? asGlyphId(value) : null;
}
