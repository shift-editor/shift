import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GlyphCatalogCanvas } from "./GlyphCatalogCanvas";
import { GlyphCatalogLayout } from "./glyphCatalogLayout";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { getShiftHost } from "@/host/shiftHost";

/** Coordinates the native scroll viewport and its two canvas-owned catalog layers. */
export const GlyphGrid = memo(function GlyphGrid() {
  const {
    filteredGlyphs,
    location,
    metrics,
    sourceId,
    atlasSource,
    observeAtlasInvalidation,
    editable,
    openGlyph,
  } = useGlyphCatalog();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [[viewportWidth, viewportHeight], setViewportSize] = useState<
    readonly [width: number, height: number]
  >([0, 0]);
  const [catalogReady, setCatalogReady] = useState(false);
  const layout = useMemo(
    () => new GlyphCatalogLayout(viewportWidth, viewportHeight, filteredGlyphs.length),
    [filteredGlyphs.length, viewportHeight, viewportWidth],
  );
  const initialMeasurementLoggedRef = useRef(false);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return undefined;

    const activeContainer = container;

    function measure(): void {
      const nextWidth = activeContainer.clientWidth;
      const nextHeight = activeContainer.clientHeight;
      setViewportSize((current) =>
        current[0] === nextWidth && current[1] === nextHeight ? current : [nextWidth, nextHeight],
      );
    }

    const observer = new ResizeObserver(measure);
    observer.observe(activeContainer);
    measure();

    return () => observer.disconnect();
  }, []);

  const showMeasuredWorkspace = useCallback(async (): Promise<void> => {
    if (initialMeasurementLoggedRef.current) return;
    initialMeasurementLoggedRef.current = true;

    try {
      await getShiftHost().session.ready();
    } catch (error) {
      console.error("failed to show measured workspace", error);
    }
  }, []);

  useEffect(() => {
    if (viewportWidth <= 0 || (!catalogReady && filteredGlyphs.length > 0)) return;

    void showMeasuredWorkspace();
  }, [catalogReady, filteredGlyphs.length, showMeasuredWorkspace, viewportWidth]);

  const handleCatalogReady = useCallback(() => setCatalogReady(true), []);
  const handleCatalogUnavailable = useCallback(() => {
    setCatalogReady(false);
    void showMeasuredWorkspace();
  }, [showMeasuredWorkspace]);

  return (
    <section className="relative h-full min-h-0 w-full overflow-hidden font-ui text-primary">
      <div
        ref={scrollContainerRef}
        className="absolute inset-0 overflow-x-hidden overflow-y-auto"
        aria-label="Glyph catalog"
      >
        <div aria-hidden="true" style={{ height: layout.totalHeight, width: 1 }} />
      </div>
      <GlyphCatalogCanvas
        containerRef={scrollContainerRef}
        glyphs={filteredGlyphs}
        location={location}
        metrics={metrics}
        sourceId={sourceId}
        active
        atlasSource={atlasSource}
        observeAtlasInvalidation={observeAtlasInvalidation}
        editable={editable}
        openGlyph={openGlyph}
        onFirstFrame={handleCatalogReady}
        onUnavailable={handleCatalogUnavailable}
      />
    </section>
  );
});
