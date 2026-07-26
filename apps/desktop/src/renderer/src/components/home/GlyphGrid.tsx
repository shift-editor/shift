import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GlyphGridRow } from "./GlyphGridRow";
import { SlugGlyphGrid } from "./SlugGlyphGrid";
import { useGlyphGridFrame } from "./useGlyphGridFrame";
import { ROW_HEIGHT, useGlyphGridVirtualization } from "./useGlyphGridVirtualization";
import { useEditor } from "@/workspace/WorkspaceContext";
import { type GlyphCatalogItem, useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { getShiftHost } from "@/host/shiftHost";
import { useSignalState } from "@/lib/signals";

/** Coordinates catalog virtualization, Glyph frame preparation, and row rendering. */
export const GlyphGrid = memo(function GlyphGrid() {
  const navigate = useNavigate();
  const editor = useEditor();
  const font = editor.font;
  const { filteredGlyphs } = useGlyphCatalog();
  const atlasRevision = useSignalState(font.slugAtlasRevisionCell);
  const [readyAtlasRevision, setReadyAtlasRevision] = useState<{
    revision: unknown;
  } | null>(null);
  const slugReady = readyAtlasRevision?.revision === atlasRevision;
  const {
    scrollContainerRef,
    rows,
    totalHeight,
    viewportHeight,
    width,
    cellWidth,
    renderedGlyphIds,
    renderedStartIndex,
    prefetchGlyphIds,
  } = useGlyphGridVirtualization(filteredGlyphs);

  // The pending window renders at deferred priority so mid-scroll updates are
  // interruptible and latest-wins; preview loading chases the live position
  // via the full prefetch band.
  const pendingRows = useDeferredValue(rows);
  const pendingGlyphIds = useDeferredValue(renderedGlyphIds);

  // Preview residency is what lets scrollbar scrubbing stream. The cache's
  // byte budget bounds memory, so every catalog warms outward from the
  // viewport until covered or at budget — no size cliff.
  const warmupGlyphIds = useMemo(() => filteredGlyphs.map((glyph) => glyph.id), [filteredGlyphs]);

  const frame = useGlyphGridFrame({
    glyphIds: pendingGlyphIds,
    prefetchGlyphIds,
    warmupGlyphIds,
    warmupCenterIndex: renderedStartIndex,
    location: editor.designLocationCell,
    enabled: !slugReady,
  });

  const metrics = useMemo(() => font.metricsAtLocation(frame.location), [font, frame.location]);
  const firstFrameReady =
    filteredGlyphs.length === 0 ||
    (pendingGlyphIds.length > 0 && pendingGlyphIds.every((glyphId) => frame.previews.has(glyphId)));
  const initialMeasurementLoggedRef = useRef(false);

  const missingPreviews = pendingGlyphIds.filter((glyphId) => !frame.previews.has(glyphId)).length;

  // Preserve an independently complete SVG fallback even while Slug is active.
  // Device loss can reveal this stale frame atomically while current previews
  // refill; a GPU-only row must never overwrite the last complete DOM frame.
  const pendingFallbackComplete = pendingRows.length > 0 && missingPreviews === 0;
  const completeFallbackRef = useRef<{
    rows: typeof pendingRows;
    previews: typeof frame.previews;
    metrics: typeof metrics;
  } | null>(null);
  if (pendingFallbackComplete) {
    completeFallbackRef.current = { rows: pendingRows, previews: frame.previews, metrics };
  }
  const display = slugReady
    ? { rows: pendingRows, previews: frame.previews, metrics }
    : (completeFallbackRef.current ?? {
        rows: pendingRows,
        previews: frame.previews,
        metrics,
      });

  // Inverse sticky (Pierre): the rendered block lives in a sticky container
  // whose offsets keep it clung to whichever viewport edge outruns rendering.
  // The pin is enforced by the compositor — a saturated main thread cannot
  // cause blank scroll regions, only stale-but-complete content.
  const blockStart = display.rows[0]?.start ?? 0;
  const lastRow = display.rows.at(-1);
  const blockHeight = lastRow ? lastRow.start + ROW_HEIGHT - blockStart : 0;
  const stickyOffset = Math.min(0, viewportHeight - blockHeight);

  useEffect(() => {
    if (width <= 0 || !firstFrameReady || initialMeasurementLoggedRef.current) return;

    initialMeasurementLoggedRef.current = true;

    async function showMeasuredWorkspace(): Promise<void> {
      try {
        await getShiftHost().workspace.ready();
      } catch (error) {
        console.error("failed to show measured workspace", error);
      }
    }

    void showMeasuredWorkspace();
  }, [firstFrameReady, width]);

  const handleSlugReady = useCallback(
    () => setReadyAtlasRevision({ revision: atlasRevision }),
    [atlasRevision],
  );
  const handleSlugUnavailable = useCallback(() => setReadyAtlasRevision(null), []);

  const handleCellClick = useCallback(
    async (glyph: GlyphCatalogItem) => {
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
    <section
      ref={scrollContainerRef}
      className="h-full min-h-0 w-full overflow-y-auto overflow-x-hidden p-5"
    >
      {filteredGlyphs.length > 0 ? (
        <SlugGlyphGrid
          containerRef={scrollContainerRef}
          glyphIds={display.rows.flatMap((row) => row.glyphs.map((glyph) => glyph.id))}
          location={frame.location}
          axes={font.getAxes()}
          metrics={display.metrics}
          sourceId={font.sourceAt(frame.location)?.id ?? null}
          atlasRevision={atlasRevision}
          visible={slugReady}
          onFirstFrame={handleSlugReady}
          onUnavailable={handleSlugUnavailable}
        />
      ) : null}
      {filteredGlyphs.length === 0 ? (
        <div className="flex h-full items-center justify-center px-4 text-sm text-muted">
          No glyphs match this filter.
        </div>
      ) : (
        <div
          style={{
            height: totalHeight,
            width: "100%",
            position: "relative",
          }}
        >
          <div style={{ height: blockStart }} />
          <div
            style={{
              position: "sticky",
              top: stickyOffset,
              bottom: stickyOffset,
              height: blockHeight,
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                transform: `translateY(${-blockStart}px)`,
              }}
            >
              {display.rows.map((row) => (
                <GlyphGridRow
                  key={row.key}
                  row={row}
                  cellWidth={cellWidth}
                  previews={display.previews}
                  metrics={display.metrics}
                  slugReady={slugReady}
                  openGlyph={handleCellClick}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
});
