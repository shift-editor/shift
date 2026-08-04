import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import type { GlyphCategory, GlyphCategoryCatalog } from "@shift/glyph-info";
import { asGlyphIndex, type GlyphIndex, type GlyphName } from "@shift/types";
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
  const routeLocation = useLocation();
  const glyphInfo = getGlyphInfo();
  const catalog = session.catalog;
  const workspace = session.workspace;

  const availableGlyphs = useSignalState(catalog.glyphsCell);
  const location = useSignalState(catalog.locationCell);
  const axes = useSignalState(catalog.axesCell);
  const metrics = useSignalState(catalog.metricsCell);
  const sourceId = useSignalState(catalog.sourceIdCell);
  const [openedGlyph, setOpenedGlyph] = useState<GlyphCatalogState["openedGlyph"]>(null);
  const openedGlyphKeyRef = useRef<GlyphCatalogItem["id"] | null>(null);
  const openGenerationRef = useRef(0);
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

  const openGlyph = useCallback<GlyphCatalogState["openGlyph"]>(
    async (glyph) => {
      const generation = openGenerationRef.current + 1;
      openGenerationRef.current = generation;
      openedGlyphKeyRef.current = glyph.id;
      const renderGlyph = await catalog.openGlyph(glyph.id);
      if (openGenerationRef.current !== generation) return;

      setOpenedGlyph(renderGlyph);
      navigate(`/editor/${encodeURIComponent(glyph.id)}`);
    },
    [catalog, navigate],
  );

  useEffect(() => {
    if (workspace) return;

    const sourceGlyphIndex = retainedGlyphIndexFromPath(routeLocation.pathname);
    if (sourceGlyphIndex === null) {
      if (routeLocation.pathname.startsWith("/editor/")) {
        openedGlyphKeyRef.current = null;
        setOpenedGlyph(null);
      }
      return;
    }
    if (!availableGlyphs.some((glyph) => glyph.id === sourceGlyphIndex)) {
      openedGlyphKeyRef.current = null;
      setOpenedGlyph(null);
      return;
    }
    const glyphIndex = sourceGlyphIndex;
    if (openedGlyphKeyRef.current === glyphIndex) return;

    openedGlyphKeyRef.current = glyphIndex;
    const generation = openGenerationRef.current + 1;
    openGenerationRef.current = generation;
    let active = true;

    async function openRouteGlyph(): Promise<void> {
      try {
        const renderGlyph = await catalog.openGlyph(glyphIndex);
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
  }, [availableGlyphs, catalog, routeLocation.pathname, workspace]);

  useEffect(() => {
    const glyphKey = openedGlyphKeyRef.current;
    if (typeof glyphKey !== "number") return;
    const sourceGlyphIndex = glyphKey;

    const generation = openGenerationRef.current + 1;
    openGenerationRef.current = generation;
    let active = true;

    async function refreshOpenedGlyph(): Promise<void> {
      try {
        const renderGlyph = await catalog.openGlyph(sourceGlyphIndex);
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

function glyphKey(glyph: GlyphCatalogItem) {
  return glyph.id;
}

function retainedGlyphIndexFromPath(pathname: string): GlyphIndex | null {
  const prefix = "/editor/";
  if (!pathname.startsWith(prefix)) return null;

  let value: string;
  try {
    value = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }

  const glyphIndex = Number(value);
  return Number.isSafeInteger(glyphIndex) && glyphIndex >= 0 ? asGlyphIndex(glyphIndex) : null;
}
