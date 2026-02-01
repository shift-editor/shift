import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useSignalState } from "@/lib/reactive";
import { CELL_HEIGHT, GlyphPreview } from "@/components/GlyphPreview";
import { glyphOutlineStore } from "@/store/GlyphOutlineStore";
import { ADOBE_LATIN_1 } from "@data/adobe-latin-1";
import { Button, Input } from "@shift/ui";

const ROW_HEIGHT = CELL_HEIGHT + 40 + 8;
const NOMINAL_CELL_WIDTH = 80;
const GAP = 8;
const SCROLL_PADDING = 40;
const OVERSCAN = 5;

function unicodeToHex(unicode: number): string {
  return unicode.toString(16).padStart(4, "0").toUpperCase();
}

export const GlyphGrid = memo(function GlyphGrid() {
  const navigate = useNavigate();
  const fontLoaded = useSignalState(glyphOutlineStore.fontLoaded);
  const fontUnicodes = useSignalState(glyphOutlineStore.fontUnicodes);
  const fontMetrics = useSignalState(glyphOutlineStore.fontMetrics);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const unicodes = useMemo(
    () =>
      fontLoaded ? fontUnicodes : Object.values(ADOBE_LATIN_1).map((g) => parseInt(g.unicode, 16)),
    [fontLoaded, fontUnicodes],
  );

  const [columns, setColumns] = useState(10);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return undefined;
    const updateColumns = (width: number) => {
      const availableWidth = width - SCROLL_PADDING;
      const newColumns = Math.max(1, Math.floor(availableWidth / (NOMINAL_CELL_WIDTH + GAP)));
      setColumns(newColumns);
    };
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) updateColumns(width);
    });
    ro.observe(container);
    const { width } = container.getBoundingClientRect();
    if (width > 0) updateColumns(width);
    return () => ro.disconnect();
  }, []);

  const rowCount = Math.ceil(unicodes.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const [inputValues, setInputValues] = useState<Record<string, string>>({});

  const handleInputChange = useCallback((unicode: number, value: string) => {
    setInputValues((prev) => ({ ...prev, [unicodeToHex(unicode)]: value }));
  }, []);

  const handleCellClick = useCallback(
    (unicode: number) => {
      navigate(`/editor/${unicodeToHex(unicode)}`);
    },
    [navigate],
  );

  return (
    <section
      ref={scrollContainerRef}
      className="h-full w-full overflow-y-auto overflow-x-hidden p-5"
    >
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
                  className="flex flex-col items-center gap-2"
                  style={{ minHeight: CELL_HEIGHT + 20 }}
                >
                  <Button
                    variant="ghost"
                    style={{ height: CELL_HEIGHT }}
                    onClick={() => handleCellClick(unicode)}
                  >
                    <GlyphPreview
                      unicode={unicode}
                      height={CELL_HEIGHT}
                      fontMetrics={fontMetrics}
                    />
                  </Button>
                  <Input
                    className="w-full max-w-[64px] text-center bg-none"
                    value={inputValues[unicodeToHex(unicode)] ?? String.fromCodePoint(unicode)}
                    onChange={(e) => handleInputChange(unicode, e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
});
