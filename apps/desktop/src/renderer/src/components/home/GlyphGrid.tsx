import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { GlyphGridRow } from "./GlyphGridRow";
import { useGlyphGridFrame } from "./useGlyphGridFrame";
import { ROW_HEIGHT, useGlyphGridVirtualization } from "./useGlyphGridVirtualization";
import { useEditor } from "@/workspace/WorkspaceContext";
import { type GlyphCatalogItem, useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { getShiftHost } from "@/host/shiftHost";

/** Coordinates catalog virtualization, Glyph frame preparation, and row rendering. */
export const GlyphGrid = memo(function GlyphGrid() {
  const navigate = useNavigate();
  const editor = useEditor();
  const font = editor.font;
  const { filteredGlyphs } = useGlyphCatalog();
  const {
    scrollContainerRef,
    rows,
    totalHeight,
    viewportHeight,
    width,
    columns,
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
  });

  const metrics = useMemo(() => font.metricsAtLocation(frame.location), [font, frame.location]);
  const firstFrameReady =
    filteredGlyphs.length === 0 ||
    (pendingGlyphIds.length > 0 && pendingGlyphIds.every((glyphId) => frame.previews.has(glyphId)));
  const initialMeasurementLoggedRef = useRef(false);

  const missingPreviews = pendingGlyphIds.filter((glyphId) => !frame.previews.has(glyphId)).length;
  const blankEpisodeRef = useRef<{ since: number; maxMissing: number } | null>(null);

  // Atomic frames: a window is displayed only once every cell has a preview.
  // Until then the last complete window stays up — stale glyphs, never
  // placeholder fields, per the review-surface doctrine.
  const pendingComplete = pendingRows.length > 0 && missingPreviews === 0;
  const completeFrameRef = useRef<{
    rows: typeof pendingRows;
    previews: typeof frame.previews;
    metrics: typeof metrics;
  } | null>(null);
  if (pendingComplete) {
    completeFrameRef.current = { rows: pendingRows, previews: frame.previews, metrics };
  }
  const display = completeFrameRef.current ?? {
    rows: pendingRows,
    previews: frame.previews,
    metrics,
  };

  // Inverse sticky (Pierre): the rendered block lives in a sticky container
  // whose offsets keep it clung to whichever viewport edge outruns rendering.
  // The pin is enforced by the compositor — a saturated main thread cannot
  // cause blank scroll regions, only stale-but-complete content.
  const blockStart = display.rows[0]?.start ?? 0;
  const lastRow = display.rows.at(-1);
  const blockHeight = lastRow ? lastRow.start + ROW_HEIGHT - blockStart : 0;
  const stickyOffset = Math.min(0, viewportHeight - blockHeight);

  useEffect(() => {
    if (missingPreviews > 0) {
      const episode = blankEpisodeRef.current;
      if (episode) {
        episode.maxMissing = Math.max(episode.maxMissing, missingPreviews);
      } else {
        blankEpisodeRef.current = { since: performance.now(), maxMissing: missingPreviews };
      }
      return;
    }

    if (blankEpisodeRef.current) {
      console.info("[glyph-blank]", {
        blankMs: Math.round(performance.now() - blankEpisodeRef.current.since),
        maxMissing: blankEpisodeRef.current.maxMissing,
      });
      blankEpisodeRef.current = null;
    }
  }, [missingPreviews]);

  useEffect(() => {
    if (width <= 0 || !firstFrameReady || initialMeasurementLoggedRef.current) return;

    initialMeasurementLoggedRef.current = true;
    console.info("[glyph-grid] first frame ready", {
      glyphCount: renderedGlyphIds.length,
      rowCount: rows.length,
      width,
      columns,
    });

    async function showMeasuredWorkspace(): Promise<void> {
      try {
        await getShiftHost().workspace.ready();
      } catch (error) {
        console.error("failed to show measured workspace", error);
      }
    }

    void showMeasuredWorkspace();
  }, [columns, firstFrameReady, renderedGlyphIds.length, rows, width]);

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
