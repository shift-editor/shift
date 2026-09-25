import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import type { GlyphCategory, GlyphCategoryCatalog } from "@shift/glyph-info";
import { asGlyphId, type GlyphId, type GlyphName } from "@shift/types";
import { effect, useSignalState } from "@shift/editor/signals";
import { useFontSession } from "@/workspace/WorkspaceContext";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { useListSelection } from "@/hooks/useListSelection";
import { LatestRequest } from "@shift/editor";
import { GlyphCatalogContext } from "./GlyphCatalogContext";
import type {
  GlyphCatalogItem,
  GlyphCatalogSource,
  GlyphCategoryFilter,
} from "@/types/glyphCatalog";

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
  const canAuthor = session.mode === "workspace";
  const workspace = session.workspace;

  const availableGlyphs = useSignalState(catalog.glyphsCell);
  const location = useSignalState(catalog.locationCell);
  const axes = useSignalState(catalog.axesCell);
  const metrics = useSignalState(catalog.metricsCell);
  const sourceId = useSignalState(catalog.sourceIdCell);
  const [openedGlyph, setOpenedGlyph] = useState<GlyphCatalogSource["openedGlyph"]>(null);
  const openedGlyphKeyRef = useRef<GlyphCatalogItem["id"] | null>(null);
  const openRequestRef = useRef(new LatestRequest());
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

  const glyphPreviews = useCallback<GlyphCatalogSource["glyphPreviews"]>(
    (glyphIds, previewLocation) => catalog.glyphPreviews(glyphIds, previewLocation),
    [catalog],
  );

  const [query, setQuery] = useState("");
  const [categoryFilters, setCategoryFilters] = useState<readonly GlyphCategoryFilter[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<ReadonlySet<GlyphCategory>>(
    () => new Set(),
  );

  const availableUnicodes = useMemo(
    () => availableGlyphs.flatMap((glyph) => (glyph.unicode === null ? [] : [glyph.unicode])),
    [availableGlyphs],
  );

  const categoryCatalog = useMemo<GlyphCategoryCatalog>(
    () => glyphInfo.createCategoryCatalog(availableUnicodes),
    [availableUnicodes, glyphInfo],
  );
  const visibleCategoryFilters = useMemo<readonly GlyphCategoryFilter[]>(
    () =>
      categoryCatalog.categories.flatMap((category) => [
        { category: category.category, subCategoryKey: null },
        ...(expandedCategories.has(category.category)
          ? category.subCategories.map((subCategory) => ({
              category: category.category,
              subCategoryKey: subCategory.key,
            }))
          : []),
      ]),
    [categoryCatalog.categories, expandedCategories],
  );
  const { selectItem: selectCategoryFilter } = useListSelection(
    visibleCategoryFilters,
    categoryFilters,
    setCategoryFilters,
    sameCategoryFilter,
  );

  const filteredGlyphs = useMemo(() => {
    const searchLimit = Math.max(availableUnicodes.length, 200);
    const categoryFilteredUnicodes = new Set(
      categoryFilters.length === 0
        ? categoryCatalog.filter({ query, searchLimit })
        : categoryFilters.flatMap((filter) =>
            categoryCatalog.filter({
              query,
              category: filter.category,
              subCategoryKey: filter.subCategoryKey,
              searchLimit,
            }),
          ),
    );

    const normalizedQuery = query.trim().toLowerCase();
    const filteringByCategory = categoryFilters.length > 0;

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
  }, [availableGlyphs, availableUnicodes.length, categoryCatalog, categoryFilters, query]);

  const openGlyph = useCallback<GlyphCatalogSource["openGlyph"]>(
    async (glyph) => {
      openedGlyphKeyRef.current = glyph.id;
      const result = await openRequestRef.current.run(() => catalog.openGlyph(glyph.id));
      if (result.status === "stale") return;

      setOpenedGlyph(result.result);
      navigateRef.current(`/editor/${encodeURIComponent(glyph.id)}`);
    },
    [catalog],
  );

  useEffect(() => {
    const sourceGlyphId = glyphIdFromPath(routeLocation.pathname);
    if (sourceGlyphId === null) {
      if (routeLocation.pathname.startsWith("/editor/")) {
        openRequestRef.current.invalidate();
        openedGlyphKeyRef.current = null;
        setOpenedGlyph(null);
        navigateRef.current("/home", { replace: true });
      }
      return;
    }
    if (!availableGlyphs.some((glyph) => glyph.id === sourceGlyphId)) {
      openRequestRef.current.invalidate();
      openedGlyphKeyRef.current = null;
      setOpenedGlyph(null);
      navigateRef.current("/home", { replace: true });
      return;
    }
    const glyphId = sourceGlyphId;
    if (openedGlyphKeyRef.current === glyphId) return;

    openedGlyphKeyRef.current = glyphId;
    let active = true;

    async function openRouteGlyph(): Promise<void> {
      try {
        const result = await openRequestRef.current.run(() => catalog.openGlyph(glyphId));
        if (!active || result.status === "stale") return;

        setOpenedGlyph(result.result);
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
    let active = true;

    async function refreshOpenedGlyph(): Promise<void> {
      try {
        const result = await openRequestRef.current.run(() => catalog.openGlyph(glyphId));
        if (!active || result.status === "stale") return;

        setOpenedGlyph(result.result);
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
    setCategoryFilters([]);
    return record.name;
  }, [workspace]);

  return {
    availableGlyphs: [...availableGlyphs],
    filteredGlyphs,
    categories: categoryCatalog.categories,
    categoryFilters,
    visibleCategoryFilters,
    expandedCategories,
    setExpandedCategories,
    query,
    setQuery,
    atlasSource: catalog.atlas,
    observeAtlasInvalidation,
    glyphPreviews,
    location,
    axes,
    metrics,
    sourceId,
    canAuthor,
    openedGlyph,
    openGlyph,
    createQuickGlyph,
    selectAll: () => setCategoryFilters([]),
    selectCategory: (category, mode) => {
      selectCategoryFilter({ category, subCategoryKey: null }, mode);
    },
    selectSubCategory: (category, subCategoryKey, mode) => {
      selectCategoryFilter({ category, subCategoryKey }, mode);
    },
  };
};

function glyphId(glyph: GlyphCatalogItem) {
  return glyph.id;
}

function sameCategoryFilter(left: GlyphCategoryFilter, right: GlyphCategoryFilter) {
  return left.category === right.category && left.subCategoryKey === right.subCategoryKey;
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
