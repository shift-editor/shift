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
import { type VirtualItem, useVirtualizer } from "@tanstack/react-virtual";
import { CELL_HEIGHT, GlyphPreview } from "@/components/home/GlyphPreview";
import { useEditor } from "@/workspace/WorkspaceContext";
import { getGlyphInfo } from "@/workspace/glyphInfo";
import { type GlyphCatalogItem, useGlyphCatalog } from "@/context/GlyphCatalogContext";
import { Button, Input } from "@shift/ui";
import type { GlyphId, GlyphName } from "@shift/types";
import type { Glyph } from "@/lib/model/Glyph";

const ROW_HEIGHT = CELL_HEIGHT + 40 + 8;
const NOMINAL_CELL_WIDTH = 100;
const GAP = 8;
const SCROLL_PADDING = 4;
const ROW_PADDING_X = 4;
const OVERSCAN = 5;

function computeLayout(width: number) {
  const availableWidth = width - SCROLL_PADDING - ROW_PADDING_X;
  const columns = Math.max(1, Math.floor(availableWidth / (NOMINAL_CELL_WIDTH + GAP)));
  const cellWidth = (availableWidth - (columns - 1) * GAP) / columns;
  return { columns, cellWidth };
}

function visibleGlyphIdsForRows(
  glyphs: readonly GlyphCatalogItem[],
  columns: number,
  rows: readonly VirtualItem[],
): readonly GlyphId[] {
  const glyphIds: GlyphId[] = [];
  for (const row of rows) {
    const startIndex = row.index * columns;
    const rowGlyphs = glyphs.slice(startIndex, startIndex + columns);
    for (const glyph of rowGlyphs) {
      if (glyph.exists) glyphIds.push(glyph.id);
    }
  }
  return glyphIds;
}

function mergeLoadedGlyphs(
  current: ReadonlyMap<GlyphId, Glyph>,
  loaded: ReadonlyMap<GlyphId, Glyph>,
): ReadonlyMap<GlyphId, Glyph> {
  let next: Map<GlyphId, Glyph> | null = null;
  for (const [glyphId, glyph] of loaded) {
    if (current.get(glyphId) === glyph) continue;
    next ??= new Map(current);
    next.set(glyphId, glyph);
  }
  return next ?? current;
}

export const GlyphGrid = memo(function GlyphGrid() {
  const navigate = useNavigate();
  const editor = useEditor();
  const font = editor.font;
  const metrics = font.metrics;
  const designLocation = editor.$designLocation;
  const { filteredGlyphs: glyphs } = useGlyphCatalog();

  const scrollContainerRef = useRef<HTMLDivElement>(null);

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

  const rowCount = Math.ceil(glyphs.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const visibleRowsKey = virtualRows.map((row) => row.index).join(",");
  const visibleGlyphIds = useMemo(
    () => visibleGlyphIdsForRows(glyphs, columns, virtualRows),
    [glyphs, columns, visibleRowsKey],
  );
  const [loadedGlyphs, setLoadedGlyphs] = useState<ReadonlyMap<GlyphId, Glyph>>(() => new Map());

  useEffect(() => {
    if (visibleGlyphIds.length === 0) return;

    async function loadVisibleGlyphs() {
      const nextGlyphs = await font.loadGlyphs(visibleGlyphIds);
      setLoadedGlyphs((current) => mergeLoadedGlyphs(current, nextGlyphs));
    }

    loadVisibleGlyphs().catch((error) => {
      console.error("failed to load visible glyphs", error);
    });
  }, [font, visibleGlyphIds]);

  const handleCellClick = useCallback(
    async (glyph: GlyphCatalogItem) => {
      if (!glyph.exists) return;
      const loadedGlyph = await font.loadGlyph(glyph.id);
      if (!loadedGlyph) return;
      navigate(`/editor/${encodeURIComponent(glyph.id)}`);
    },
    [font, navigate],
  );

  return (
    <section
      ref={scrollContainerRef}
      className="h-full min-h-0 w-full overflow-y-auto overflow-x-hidden p-5"
    >
      {glyphs.length === 0 ? (
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
          {virtualRows.map((virtualRow) => {
            const startIndex = virtualRow.index * columns;
            const rowGlyphs = glyphs.slice(startIndex, startIndex + columns);
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
                {rowGlyphs.map((glyph) => {
                  const previewGlyph = glyph.exists ? (loadedGlyphs.get(glyph.id) ?? null) : null;
                  return (
                    <div
                      key={glyph.name}
                      className="flex min-w-0 flex-col items-center gap-2"
                      style={{
                        minHeight: CELL_HEIGHT + 20,
                        width: cellWidth,
                        maxWidth: cellWidth,
                      }}
                    >
                      <Button
                        variant="ghost"
                        className="w-full min-w-0 overflow-hidden"
                        style={{ height: CELL_HEIGHT }}
                        onClick={() => handleCellClick(glyph)}
                      >
                        <GlyphPreview
                          glyph={previewGlyph}
                          unicode={glyph.unicode}
                          metrics={metrics}
                          designLocation={designLocation}
                          height={CELL_HEIGHT}
                        />
                      </Button>
                      <GlyphNameInput glyph={glyph} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
});

function GlyphNameInput({ glyph }: { readonly glyph: GlyphCatalogItem }) {
  const editor = useEditor();
  const glyphInfo = getGlyphInfo();
  const glyphName = glyph.name;
  const [draft, setDraft] = useState(glyphName);

  useEffect(() => {
    setDraft(glyphName);
  }, [glyphName]);

  const commit = () => {
    const next = draft.trim() as GlyphName;
    if (!glyph.exists || next === glyphName) {
      setDraft(glyphName);
      return;
    }

    if (!next || editor.font.recordForName(next)) {
      setDraft(glyphName);
      return;
    }

    const resolved = glyphInfo.getGlyphByName(next);
    editor.font.updateGlyphIdentity(glyph.id, next, resolved ? [resolved.codepoint] : []);
  };

  return (
    <Input
      value={draft}
      readOnly={!glyph.exists}
      onChange={(event) => setDraft(event.currentTarget.value as GlyphName)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.nativeEvent.stopImmediatePropagation();

        if (event.key === "Enter") {
          event.currentTarget.blur();
          return;
        }

        if (event.key === "Escape") {
          setDraft(glyphName);
          event.currentTarget.blur();
          return;
        }

        if (event.metaKey && event.key === "a") {
          event.currentTarget.select();
        }
      }}
      className="h-7 w-full truncate text-center text-xs text-muted-foreground focus:ring-inset read-only:cursor-default read-only:bg-transparent read-only:focus:ring-0"
    />
  );
}
