import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSignalState } from "@shift/editor/signals";
import { useLocation } from "react-router";
import { GlyphCatalogBackendGate } from "./GlyphCatalogBackendGate";
import { GlyphGridFooter } from "./GlyphGridFooter";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { getShiftHost } from "@/host/shiftHost";
import { colorsInUse, filterByColor, glyphCountLabel } from "@/lib/glyph-grid/colorFilter";
import { useFontSession } from "@/workspace/WorkspaceContext";

/** Coordinates shared catalog data and session-fixed backend selection. */
export const GlyphGrid = memo(function GlyphGrid() {
  const catalogActive = useLocation().pathname === "/home";
  const {
    availableGlyphs,
    filteredGlyphs,
    location,
    metrics,
    sourceId,
    atlasSource,
    observeAtlasInvalidation,
    glyphPreviews,
    canAuthor,
    openGlyph,
    selectGlyphs,
  } = useGlyphCatalog();
  // Read here rather than through the catalog, whose other readers would rerender on every drag.
  const { tabs } = useFontSession();
  const windowSelection = useSignalState(tabs.gridSelectionCell);
  const { gridView } = tabs;
  const tileSize = useSignalState(gridView.tileSizeCell);
  const colorFilter = useSignalState(gridView.colorFilterCell);
  // The colour filter narrows what the sidebar's filters and the search already show.
  const shownGlyphs = useMemo(
    () => filterByColor(filteredGlyphs, colorFilter),
    [colorFilter, filteredGlyphs],
  );
  const colors = useMemo(
    () => colorsInUse(filteredGlyphs, colorFilter),
    [colorFilter, filteredGlyphs],
  );
  const glyphIds = useMemo(() => shownGlyphs.map((glyph) => glyph.id), [shownGlyphs]);
  // Glyphs a filter hides leave the selection drawn; the next click selects among those shown.
  const selection = useMemo(
    () => windowSelection.withGlyphs(glyphIds),
    [glyphIds, windowSelection],
  );
  const [catalogReady, setCatalogReady] = useState(false);
  const workspaceReadyRef = useRef(false);

  const showMeasuredWorkspace = useCallback(async (): Promise<void> => {
    if (workspaceReadyRef.current) return;
    workspaceReadyRef.current = true;

    try {
      await getShiftHost().session.ready();
    } catch (error) {
      console.error("failed to show measured workspace", error);
    }
  }, []);

  useEffect(() => {
    // The catalog only paints on Home, so a window opening on an editor route has no frame to await.
    const awaitingCatalogFrame = catalogActive && !catalogReady && shownGlyphs.length > 0;
    if (awaitingCatalogFrame) return;

    void showMeasuredWorkspace();
  }, [catalogActive, catalogReady, shownGlyphs.length, showMeasuredWorkspace]);

  const handleCatalogReady = useCallback(() => setCatalogReady(true), []);
  const handleCatalogUnavailable = useCallback(() => {
    setCatalogReady(false);
    void showMeasuredWorkspace();
  }, [showMeasuredWorkspace]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <section
        aria-label="Glyph catalog surface"
        data-filtered-glyph-count={shownGlyphs.length}
        data-first-glyph-id={shownGlyphs[0]?.id}
        className="relative min-h-0 w-full flex-1 overflow-hidden font-ui text-primary"
      >
        <GlyphCatalogBackendGate
          glyphs={shownGlyphs}
          location={location}
          metrics={metrics}
          sourceId={sourceId}
          active={catalogActive}
          atlasSource={atlasSource}
          observeAtlasInvalidation={observeAtlasInvalidation}
          glyphPreviews={glyphPreviews}
          canAuthor={canAuthor}
          openGlyph={openGlyph}
          selection={selection}
          selectGlyphs={selectGlyphs}
          tileSize={tileSize}
          onFirstFrame={handleCatalogReady}
          onUnavailable={handleCatalogUnavailable}
        />
        {shownGlyphs.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 z-4 flex items-center justify-center px-4 text-sm text-muted">
            No glyphs match this filter.
          </div>
        ) : null}
      </section>
      <GlyphGridFooter
        countLabel={glyphCountLabel(shownGlyphs.length, availableGlyphs.length, colorFilter)}
        colors={colors}
        colorFilter={colorFilter}
        filterColor={(color, add) => gridView.filterColor(color, add)}
        tileSize={tileSize}
        setTileSize={(size) => gridView.setTileSize(size)}
      />
    </div>
  );
});
