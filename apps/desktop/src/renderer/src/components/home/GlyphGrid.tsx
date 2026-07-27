import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlyphCatalogCanvas } from "./GlyphCatalogCanvas";
import { deriveGlyphCatalogLayout } from "./glyphCatalogLayout";
import { useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { getShiftHost } from "@/host/shiftHost";
import { useSignalState } from "@/lib/signals";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";
import { useEditor } from "@/workspace/WorkspaceContext";

/** Coordinates the native scroll viewport and its two canvas-owned catalog layers. */
export const GlyphGrid = memo(function GlyphGrid() {
  const navigate = useNavigate();
  const editor = useEditor();
  const font = editor.font;
  const { filteredGlyphs } = useGlyphCatalog();
  const atlasRevision = useSignalState(font.slugAtlasRevisionCell);
  const location = useSignalState(editor.designLocationCell);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [[viewportWidth, viewportHeight], setViewportSize] = useState<
    readonly [width: number, height: number]
  >([0, 0]);
  const [readyAtlasRevision, setReadyAtlasRevision] = useState<{
    revision: unknown;
  } | null>(null);
  const slugReady = readyAtlasRevision?.revision === atlasRevision;
  const layout = useMemo(
    () => deriveGlyphCatalogLayout(viewportWidth, viewportHeight, filteredGlyphs.length),
    [filteredGlyphs.length, viewportHeight, viewportWidth],
  );
  const metrics = useMemo(() => font.metricsAtLocation(location), [font, location]);
  const axes = font.getAxes();
  const sourceId = font.sourceAt(location)?.id ?? null;
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
      await getShiftHost().workspace.ready();
    } catch (error) {
      console.error("failed to show measured workspace", error);
    }
  }, []);

  useEffect(() => {
    if (viewportWidth <= 0 || (!slugReady && filteredGlyphs.length > 0)) return;

    void showMeasuredWorkspace();
  }, [filteredGlyphs.length, showMeasuredWorkspace, slugReady, viewportWidth]);

  const handleSlugReady = useCallback(
    () => setReadyAtlasRevision({ revision: atlasRevision }),
    [atlasRevision],
  );
  const handleSlugUnavailable = useCallback(() => {
    setReadyAtlasRevision(null);
    void showMeasuredWorkspace();
  }, [showMeasuredWorkspace]);

  const handleCellClick = useCallback(
    async (glyph: GlyphCatalogItem): Promise<void> => {
      try {
        await font.loadGlyph(glyph.id);
        navigate(`/editor/${encodeURIComponent(glyph.id)}`);
      } catch (error) {
        console.error("failed to load Glyph", error);
      }
    },
    [font, navigate],
  );

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
        axes={axes}
        metrics={metrics}
        sourceId={sourceId}
        atlasRevision={atlasRevision}
        visible={slugReady}
        openGlyph={handleCellClick}
        onFirstFrame={handleSlugReady}
        onUnavailable={handleSlugUnavailable}
      />
    </section>
  );
});
