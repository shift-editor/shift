import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { GlyphCatalogBackendGate } from "./GlyphCatalogBackendGate";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { getShiftHost } from "@/host/shiftHost";

/** Coordinates shared catalog data and session-fixed backend selection. */
export const GlyphGrid = memo(function GlyphGrid() {
  const catalogActive = useLocation().pathname === "/home";
  const {
    filteredGlyphs,
    location,
    metrics,
    sourceId,
    atlasSource,
    observeAtlasInvalidation,
    glyphPreviews,
    canAuthor,
    openGlyph,
  } = useGlyphCatalog();
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
    if (!catalogReady && filteredGlyphs.length > 0) return;

    void showMeasuredWorkspace();
  }, [catalogReady, filteredGlyphs.length, showMeasuredWorkspace]);

  const handleCatalogReady = useCallback(() => setCatalogReady(true), []);
  const handleCatalogUnavailable = useCallback(() => {
    setCatalogReady(false);
    void showMeasuredWorkspace();
  }, [showMeasuredWorkspace]);

  return (
    <section
      aria-label="Glyph catalog surface"
      data-filtered-glyph-count={filteredGlyphs.length}
      data-first-glyph-id={filteredGlyphs[0]?.id}
      className="relative h-full min-h-0 w-full overflow-hidden font-ui text-primary"
    >
      <GlyphCatalogBackendGate
        glyphs={filteredGlyphs}
        location={location}
        metrics={metrics}
        sourceId={sourceId}
        active={catalogActive}
        atlasSource={atlasSource}
        observeAtlasInvalidation={observeAtlasInvalidation}
        glyphPreviews={glyphPreviews}
        canAuthor={canAuthor}
        openGlyph={openGlyph}
        onFirstFrame={handleCatalogReady}
        onUnavailable={handleCatalogUnavailable}
      />
      {filteredGlyphs.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-[4] flex items-center justify-center px-4 text-sm text-muted">
          No glyphs match this filter.
        </div>
      ) : null}
    </section>
  );
});
