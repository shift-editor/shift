import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Button } from "@shift/ui";
import { GlyphPreviewSvg } from "./GlyphPreviewSvg";
import { GlyphCatalogLayout } from "@/components/home/glyphCatalogLayout";
import { useGlyphPreviewFrame } from "@/components/home/useGlyphPreviewFrame";
import { GLYPH_DRAG_TYPE } from "@/lib/glyph-grid/insertGlyph";
import { markColorCss, markColorKey } from "@/lib/glyph-grid/markColor";
import type { CatalogMetrics } from "@shift/types";
import type { CatalogLocation, GlyphCatalogItem, GlyphCatalogSource } from "@/types/glyphCatalog";

interface GlyphTilesProps {
  readonly glyphs: readonly GlyphCatalogItem[];
  readonly location: CatalogLocation;
  readonly metrics: CatalogMetrics;
  readonly tileSize: number;
  readonly glyphPreviews: GlyphCatalogSource["glyphPreviews"];
  readonly observeAtlasInvalidation: GlyphCatalogSource["observeAtlasInvalidation"];
  /** Called for a click on a glyph's tile, with whether ⌘ or Ctrl was held. */
  readonly onPick: (glyph: GlyphCatalogItem, withCommand: boolean) => void;
}

const noop = () => {};

/**
 * Glyphs as a scrolling grid of small tiles to pick from: each is a button
 * filled with the glyph's tag colour, and can be dragged to where a glyph is
 * wanted. Only the tiles in view are mounted.
 */
export function GlyphTiles({
  glyphs,
  location,
  metrics,
  tileSize,
  glyphPreviews,
  observeAtlasInvalidation,
  onPick,
}: GlyphTilesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [[viewportWidth, viewportHeight], setViewportSize] = useState<
    readonly [width: number, height: number]
  >([0, 0]);
  const [scrollTop, setScrollTop] = useState(0);
  const layout = useMemo(
    () => new GlyphCatalogLayout(viewportWidth, viewportHeight, glyphs.length, tileSize, "compact"),
    [glyphs.length, tileSize, viewportHeight, viewportWidth],
  );
  const frame = useMemo(() => layout.frame(glyphs, scrollTop), [glyphs, layout, scrollTop]);
  const [, previews] = useGlyphPreviewFrame(
    frame,
    location,
    viewportWidth > 0 && viewportHeight > 0,
    glyphPreviews,
    observeAtlasInvalidation,
    noop,
    noop,
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const measure = () =>
      setViewportSize((current) => {
        const next = [container.clientWidth, container.clientHeight] as const;
        return current[0] === next[0] && current[1] === next[1] ? current : next;
      });
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    measure();
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-x-hidden overflow-y-auto"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="relative" style={{ height: layout.totalHeight, width: "100%" }}>
        {frame.cells.map((cell) => {
          const preview = previews.get(cell.glyph.id);
          return (
            <div
              key={cell.glyph.id}
              draggable
              data-mark-color={markColorKey(cell.glyph.markColor)}
              className="absolute overflow-hidden rounded-xs border border-tile-ink bg-tile tile-shadow"
              style={{
                // A tag's colour is data; an untagged tile keeps bg-tile.
                background: cell.glyph.markColor ? markColorCss(cell.glyph.markColor) : undefined,
                height: cell.cellRect.height,
                left: cell.cellRect.left,
                top: cell.cellRect.top + frame.scrollTop,
                width: cell.cellRect.width,
              }}
              onDragStart={(event) => {
                event.dataTransfer.setData(GLYPH_DRAG_TYPE, cell.glyph.id);
                event.dataTransfer.setData("text/plain", `/${cell.glyph.name}`);
                event.dataTransfer.effectAllowed = "copy";
              }}
            >
              <Button
                aria-label={cell.glyph.displayName}
                title={cell.glyph.displayName}
                variant="ghost"
                className="flex h-full w-full items-center justify-center overflow-hidden p-0"
                onClick={(event: MouseEvent) => onPick(cell.glyph, event.metaKey || event.ctrlKey)}
              >
                {preview?.svgPath ? (
                  <GlyphPreviewSvg
                    preview={preview}
                    metrics={metrics}
                    width={cell.previewContentRect.width}
                    height={cell.previewContentRect.height}
                  />
                ) : null}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
