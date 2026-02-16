/**
 * GlyphGrid – layout and sizing
 *
 * CONTAINER (section, ref=scrollContainerRef)
 *   width = ResizeObserver(contentRect.width)  ← single source
 *
 *   +----------------------------------------------------------------------+
 *   | p-5 (20px each side)                                                 |
 *   |   content width = width - 40                                         |
 *   |   +----------------------------------------------------------------+ |
 *   |   | SCROLL_PADDING (40) + ROW_PADDING_X (32) reserved              | |
 *   |   | availableWidth = contentWidth - 40 - 32                        | |
 *   |   |                                                                | |
 *   |   | ROW (px-4 each side):                                          | |
 *   |   |   +-----+---+-----+---+-----+---+-----+                        | |
 *   |   |   |cell |GAP|cell |GAP|cell |...|cell |  ← columns × cellWidth | |
 *   |   |   +-----+---+-----+---+-----+---+-----+                        | |
 *   |   |   <-------------- availableWidth -------------->               | |
 *   |   +----------------------------------------------------------------+ |
 *   +----------------------------------------------------------------------+
 *
 * CONSTANTS
 *   NOMINAL_CELL_WIDTH  used only to derive column count (not final cell width)
 *   GAP                 between cells in a row
 *   SCROLL_PADDING      reserved width (scrollbar / stability)
 *   ROW_PADDING_X       horizontal padding per row (px-4)
 *   CELL_HEIGHT         from GlyphPreview
 *   ROW_HEIGHT          per virtual row (virtualizer estimateSize)
 *   OVERSCAN            extra rows rendered above/below viewport
 *
 * FORMULAS
 *   columns   = max(1, floor(availableWidth / (NOMINAL_CELL_WIDTH + GAP)))
 *   cellWidth = (availableWidth - (columns - 1) * GAP) / columns
 *   rowCount  = ceil(unicodes.length / columns)
 *
 * FLOW
 *   ResizeObserver(container) → width → computeLayout(width) → { columns, cellWidth }
 *   rowCount = ceil(unicodes.length / columns)
 *   useVirtualizer({ count: rowCount, estimateSize: ROW_HEIGHT })
 *   Each virtual row: unicodes.slice(rowIndex * columns, (rowIndex + 1) * columns)
 *   Row DOM: flex gap-2 px-4; each cell width/maxWidth = cellWidth, min-w-0.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { codepointToHex } from "@/lib/utils/unicode";
import { useSignalState } from "@/lib/reactive";
import { CELL_HEIGHT, GlyphPreview } from "@/components/GlyphPreview";
import { getGlyphInfo } from "@/store/glyphInfo";
import { glyphDataStore } from "@/store/GlyphDataStore";
import { ADOBE_LATIN_1 } from "@data/adobe-latin-1";
import { Button } from "@shift/ui";

const ROW_HEIGHT = CELL_HEIGHT + 40 + 8;
const NOMINAL_CELL_WIDTH = 100;
const GAP = 8;
const SCROLL_PADDING = 4;
const ROW_PADDING_X = 4;
const OVERSCAN = 5;

interface GlyphGridProps {
  unicodes?: number[];
}

function computeLayout(width: number) {
  const availableWidth = width - SCROLL_PADDING - ROW_PADDING_X;
  const columns = Math.max(1, Math.floor(availableWidth / (NOMINAL_CELL_WIDTH + GAP)));
  const cellWidth = (availableWidth - (columns - 1) * GAP) / columns;
  return { columns, cellWidth };
}

export const GlyphGrid = memo(function GlyphGrid({ unicodes: unicodesProp }: GlyphGridProps) {
  const navigate = useNavigate();
  const fontLoaded = useSignalState(glyphDataStore.fontLoaded);
  const fontUnicodes = useSignalState(glyphDataStore.fontUnicodes);
  const fontMetrics = useSignalState(glyphDataStore.fontMetrics);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const fallbackUnicodes = useMemo(
    () =>
      fontLoaded ? fontUnicodes : Object.values(ADOBE_LATIN_1).map((g) => parseInt(g.unicode, 16)),
    [fontLoaded, fontUnicodes],
  );
  const unicodes = unicodesProp ?? fallbackUnicodes;

  // Sizing: useVirtualizer only virtualizes rows (vertical); it does not provide container width.
  // We need container width to compute columns and cell width so rows don't overflow. ResizeObserver
  // is the single source for that. We avoid a sync width read on mount so layout doesn't jitter when
  // the container isn't laid out yet or when navigating back. We only set state when the computed
  // layout (columns, cellWidth) actually changes.
  const [layout, setLayout] = useState(() => ({ columns: 1, cellWidth: NOMINAL_CELL_WIDTH }));

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return undefined;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width <= 0) return;
      const next = computeLayout(width);
      setLayout((prev) =>
        prev.columns === next.columns && prev.cellWidth === next.cellWidth ? prev : next,
      );
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const { columns, cellWidth } = layout;

  const rowCount = Math.ceil(unicodes.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const glyphInfo = getGlyphInfo();

  const handleCellClick = useCallback(
    (unicode: number) => {
      navigate(`/editor/${codepointToHex(unicode)}`);
    },
    [navigate],
  );

  return (
    <section
      ref={scrollContainerRef}
      className="h-full min-h-0 w-full overflow-y-auto overflow-x-hidden p-5"
    >
      {unicodes.length === 0 ? (
        <div className="flex h-full items-center justify-center px-4 text-sm text-muted">
          No glyphs match this filter.
        </div>
      ) : (
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const startIndex = virtualRow.index * columns;
            const rowUnicodes = unicodes.slice(startIndex, startIndex + columns);
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="flex gap-2 px-4"
              >
                {rowUnicodes.map((unicode) => (
                  <div
                    key={unicode}
                    className="flex min-w-0 flex-col items-center gap-2 overflow-hidden"
                    style={{ minHeight: CELL_HEIGHT + 20, width: cellWidth, maxWidth: cellWidth }}
                  >
                    <Button
                      variant="ghost"
                      className="w-full min-w-0 overflow-hidden"
                      style={{ height: CELL_HEIGHT }}
                      onClick={() => handleCellClick(unicode)}
                    >
                      <GlyphPreview
                        unicode={unicode}
                        height={CELL_HEIGHT}
                        fontMetrics={fontMetrics}
                      />
                    </Button>
                    <span className="w-full truncate text-center text-xs text-muted-foreground">
                      {glyphInfo.getGlyphName(unicode) ?? String.fromCodePoint(unicode)}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
});
