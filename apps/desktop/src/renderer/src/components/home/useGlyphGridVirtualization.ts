import { useEffect, useMemo, useRef, useState, type Key, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CELL_HEIGHT } from "./GlyphPreview";
import type { GlyphId } from "@shift/types";
import type { GlyphCatalogItem } from "@/context/GlyphCatalogContext";

export interface GlyphGridRow {
  readonly key: Key;
  readonly start: number;
  readonly glyphs: readonly GlyphCatalogItem[];
}

export interface GlyphGridVirtualization {
  readonly scrollContainerRef: RefObject<HTMLDivElement | null>;
  readonly rows: readonly GlyphGridRow[];
  readonly totalHeight: number;
  readonly viewportHeight: number;
  readonly width: number;
  readonly columns: number;
  readonly cellWidth: number;
  readonly renderedGlyphIds: readonly GlyphId[];
  /** Catalog index of the first rendered glyph; anchors outward warm-up. */
  readonly renderedStartIndex: number;
  /** Ids in the data band beyond the rendered window, for read-ahead. */
  readonly prefetchGlyphIds: readonly GlyphId[];
}

export const ROW_HEIGHT = CELL_HEIGHT + 48;
const NOMINAL_CELL_WIDTH = 100;
const GAP = 8;
const SCROLL_PADDING = 4;
const ROW_PADDING_X = 4;
const ROW_OVERSCAN = 8;
const PREFETCH_ROWS = 40;

export function useGlyphGridVirtualization(
  glyphs: readonly GlyphCatalogItem[],
): GlyphGridVirtualization {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(() => ({
    width: 0,
    viewportHeight: 0,
    columns: 1,
    cellWidth: NOMINAL_CELL_WIDTH,
  }));

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return undefined;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      const viewportHeight = entries[0]?.contentRect.height ?? 0;
      if (width <= 0) return;

      const next = { ...gridLayout(width), viewportHeight };
      setLayout((current) =>
        current.width === next.width &&
        current.viewportHeight === next.viewportHeight &&
        current.columns === next.columns &&
        current.cellWidth === next.cellWidth
          ? current
          : next,
      );
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  const rowCount = Math.ceil(glyphs.length / layout.columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: ROW_OVERSCAN,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const rowKey = virtualRows.map((row) => row.index).join(",");
  const renderedStartIndex = (virtualRows[0]?.index ?? 0) * layout.columns;
  const lastRenderedRow = virtualRows.at(-1);
  const renderedEndIndex = lastRenderedRow
    ? Math.min(glyphs.length, (lastRenderedRow.index + 1) * layout.columns)
    : 0;

  const rows = useMemo(
    () =>
      virtualRows.map((row) => ({
        key: row.key,
        start: row.start,
        glyphs: glyphs.slice(row.index * layout.columns, (row.index + 1) * layout.columns),
      })),
    [glyphs, layout.columns, rowKey],
  );

  const renderedGlyphIds = useMemo(
    () => glyphs.slice(renderedStartIndex, renderedEndIndex).map((glyph) => glyph.id),
    [glyphs, renderedEndIndex, renderedStartIndex],
  );
  const prefetchStartIndex = Math.max(0, renderedStartIndex - PREFETCH_ROWS * layout.columns);
  const prefetchEndIndex = Math.min(
    glyphs.length,
    renderedEndIndex + PREFETCH_ROWS * layout.columns,
  );
  // The full live band including the rendered window: preview coverage must
  // chase the real scroll position even while the displayed window lags at
  // deferred priority. Resident/cached ids are filtered out by the caller.
  const prefetchGlyphIds = useMemo(
    () => glyphs.slice(prefetchStartIndex, prefetchEndIndex).map((glyph) => glyph.id),
    [glyphs, prefetchEndIndex, prefetchStartIndex],
  );

  return {
    scrollContainerRef,
    rows,
    totalHeight: virtualizer.getTotalSize(),
    viewportHeight: layout.viewportHeight,
    width: layout.width,
    columns: layout.columns,
    cellWidth: layout.cellWidth,
    renderedGlyphIds,
    renderedStartIndex,
    prefetchGlyphIds,
  };
}

function gridLayout(width: number): { width: number; columns: number; cellWidth: number } {
  const availableWidth = width - SCROLL_PADDING - ROW_PADDING_X;
  const columns = Math.max(1, Math.floor(availableWidth / (NOMINAL_CELL_WIDTH + GAP)));
  const cellWidth = (availableWidth - (columns - 1) * GAP) / columns;

  return { width, columns, cellWidth };
}
