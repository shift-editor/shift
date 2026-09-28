import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  DEFAULT_LANGUAGE_IDS,
  type GlyphCategory,
  type GlyphCategoryCatalog,
  type LanguageCatalog,
} from "@shift/glyph-info";
import { asGlyphId, type GlyphId, type GlyphName } from "@shift/types";
import { effect, signal, useSignalState } from "@shift/editor/signals";
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

const NO_LANGUAGE_IDS = signal<readonly string[] | null>(null, {
  name: "glyphCatalog.previewLanguageIds",
});

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
  const storedLanguageIds = useSignalState(
    workspace ? workspace.editor.font.languageIdsCell : NO_LANGUAGE_IDS,
  );
  const trackedLanguageIds = storedLanguageIds ?? DEFAULT_LANGUAGE_IDS;
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
  const [selectedLanguageId, setSelectedLanguageId] = useState<string | null>(null);
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
  const languageCatalog = useMemo<LanguageCatalog>(
    () => glyphInfo.createLanguageCatalog(availableUnicodes),
    [availableUnicodes, glyphInfo],
  );
  const languageScripts = useMemo(
    () => languageCatalog.scriptsFor(trackedLanguageIds),
    [languageCatalog, trackedLanguageIds],
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
    let filteredUnicodes: Set<number>;

    if (selectedLanguageId !== null) {
      const languageUnicodes = new Set(languageCatalog.filter(selectedLanguageId));
      filteredUnicodes =
        query.trim() === ""
          ? languageUnicodes
          : new Set(
              categoryCatalog
                .filter({ query, searchLimit })
                .filter((codepoint) => languageUnicodes.has(codepoint)),
            );
    } else {
      filteredUnicodes = new Set(
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
    }

    const normalizedQuery = query.trim().toLowerCase();
    const filteringByGroup = categoryFilters.length > 0 || selectedLanguageId !== null;

    return availableGlyphs.filter((glyph) => {
      const unicodeMatched = glyph.unicode !== null && filteredUnicodes.has(glyph.unicode);
      const nameMatched =
        normalizedQuery !== "" &&
        (glyph.name.toLowerCase().includes(normalizedQuery) ||
          glyph.displayName.toLowerCase().includes(normalizedQuery));

      if (filteringByGroup) return unicodeMatched;
      if (normalizedQuery !== "") return unicodeMatched || nameMatched;
      return true;
    });
  }, [
    availableGlyphs,
    availableUnicodes.length,
    categoryCatalog,
    categoryFilters,
    languageCatalog,
    query,
    selectedLanguageId,
  ]);

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
    setSelectedLanguageId(null);
    return record.name;
  }, [workspace]);

  const setTrackedLanguageIds = useCallback<GlyphCatalogSource["setTrackedLanguageIds"]>(
    (languageIds) => {
      if (!workspace) throw new Error("preview catalog cannot change tracked languages");

      workspace.editor.setLanguageIds(languageIds);
      if (selectedLanguageId !== null && !languageIds.includes(selectedLanguageId)) {
        setSelectedLanguageId(null);
      }
    },
    [selectedLanguageId, workspace],
  );

  const languageGlyphs = useCallback<GlyphCatalogSource["languageGlyphs"]>(
    (languageId) => {
      const available = new Set(availableUnicodes);
      return languageCatalog.required(languageId).map((codepoint) => ({
        codepoint,
        name: glyphInfo.getGlyphName(codepoint) ?? fallbackGlyphName(codepoint),
        present: available.has(codepoint),
      }));
    },
    [availableUnicodes, glyphInfo, languageCatalog],
  );

  const generateGlyphs = useCallback<GlyphCatalogSource["generateGlyphs"]>(
    (codepoints) => {
      if (!workspace) throw new Error("preview catalog cannot create glyphs");

      workspace.editor.createGlyphsForUnicodes(codepoints);
    },
    [workspace],
  );

  return {
    availableGlyphs: [...availableGlyphs],
    filteredGlyphs,
    categories: categoryCatalog.categories,
    languageScripts,
    allLanguageScripts: languageCatalog.scripts,
    trackedLanguageIds,
    setTrackedLanguageIds,
    languageGlyphs,
    generateGlyphs,
    categoryFilters,
    selectedLanguageId,
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
    selectAll: () => {
      setCategoryFilters([]);
      setSelectedLanguageId(null);
    },
    selectCategory: (category, mode) => {
      setSelectedLanguageId(null);
      selectCategoryFilter({ category, subCategoryKey: null }, mode);
    },
    selectSubCategory: (category, subCategoryKey, mode) => {
      setSelectedLanguageId(null);
      selectCategoryFilter({ category, subCategoryKey }, mode);
    },
    selectLanguage: (languageId) => {
      setCategoryFilters([]);
      setSelectedLanguageId(languageId);
    },
  };
};

function fallbackGlyphName(codepoint: number): string {
  const hex = codepoint.toString(16).toUpperCase();
  return codepoint > 0xffff ? `u${hex}` : `uni${hex.padStart(4, "0")}`;
}

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
