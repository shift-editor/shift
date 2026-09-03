import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@shift/ui";
import { GlyphCatalogLayout } from "./glyphCatalogLayout";
import { GlyphNameInput } from "./GlyphNameInput";
import { GlyphPreviewLayout } from "./GlyphPreviewLayout";
import { useGlyphPreviewFrame } from "./useGlyphPreviewFrame";
import type { GlyphId } from "@shift/types";
import type { SvgGlyphCatalogGridProps } from "@/types/glyphCatalog";

/** Renders the portable catalog as virtualized React cells with native DOM interaction. */
export function SvgGlyphCatalogGrid({
  glyphs,
  location,
  metrics,
  active,
  observeAtlasInvalidation,
  glyphPreviews,
  canAuthor,
  openGlyph,
  onPendingGlyphName,
  onFirstFrame,
  onUnavailable,
}: SvgGlyphCatalogGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editingInputRef = useRef<HTMLInputElement>(null);
  const [[viewportWidth, viewportHeight], setViewportSize] = useState<
    readonly [width: number, height: number]
  >([0, 0]);
  const [scrollTop, setScrollTop] = useState(0);
  const [editingGlyphId, setEditingGlyphId] = useState<GlyphId | null>(null);
  const layout = useMemo(
    () => new GlyphCatalogLayout(viewportWidth, viewportHeight, glyphs.length),
    [glyphs.length, viewportHeight, viewportWidth],
  );
  const targetFrame = useMemo(() => layout.frame(glyphs, scrollTop), [glyphs, layout, scrollTop]);
  const [, previews, readiness, cacheBytes] = useGlyphPreviewFrame(
    targetFrame,
    location,
    active && viewportWidth > 0 && viewportHeight > 0,
    glyphPreviews,
    observeAtlasInvalidation,
    onFirstFrame,
    onUnavailable,
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const activeContainer = container;

    function measure(): void {
      setViewportSize((current) => {
        const next = [activeContainer.clientWidth, activeContainer.clientHeight] as const;
        return current[0] === next[0] && current[1] === next[1] ? current : next;
      });
    }

    const observer = new ResizeObserver(measure);
    observer.observe(activeContainer);
    measure();

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (editingGlyphId && !targetFrame.cells.some((cell) => cell.glyph.id === editingGlyphId)) {
      setEditingGlyphId(null);
    }
  }, [editingGlyphId, targetFrame.cells]);

  useLayoutEffect(() => {
    if (!editingGlyphId) return;

    editingInputRef.current?.focus();
    editingInputRef.current?.select();
  }, [editingGlyphId]);

  async function handleOpenGlyph(glyphId: GlyphId): Promise<void> {
    const glyph = glyphs.find((candidate) => candidate.id === glyphId);
    if (!glyph) return;

    try {
      await openGlyph(glyph);
    } catch (error) {
      console.error("failed to open catalog Glyph", error);
    }
  }

  return (
    <div
      ref={containerRef}
      aria-label="Glyph catalog"
      data-testid="glyph-catalog-svg"
      data-glyph-catalog-renderer="svg"
      data-grid-readiness={readiness}
      data-preview-cache-bytes={cacheBytes}
      data-first-glyph-name={glyphs[0]?.displayName}
      className="absolute inset-0 overflow-x-hidden overflow-y-auto"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="relative" style={{ height: layout.totalHeight, width: "100%" }}>
        {targetFrame.cells.map((cell) => {
          const preview = previews.get(cell.glyph.id);
          const previewLayout = preview
            ? new GlyphPreviewLayout(metrics, preview.xAdvance, cell.previewRect.height)
            : null;
          const top = cell.cellRect.top + targetFrame.scrollTop;

          return (
            <div
              key={cell.glyph.id}
              className="absolute flex flex-col"
              style={{
                height: cell.cellRect.height,
                left: cell.cellRect.left,
                top,
                width: cell.cellRect.width,
              }}
            >
              <Button
                aria-label={`Open ${cell.glyph.displayName}`}
                variant="ghost"
                className="flex w-full items-center justify-center overflow-hidden p-0 hover:bg-hover"
                style={{ height: cell.previewRect.height }}
                onClick={async () => handleOpenGlyph(cell.glyph.id)}
              >
                {preview?.svgPath && previewLayout ? (
                  <svg
                    aria-hidden="true"
                    width={cell.previewContentRect.width}
                    height={cell.previewContentRect.height}
                    viewBox={previewLayout.viewBox}
                    preserveAspectRatio="xMidYMid meet"
                    className="overflow-hidden"
                  >
                    <g transform="scale(1, -1)">
                      <path d={preview.svgPath} fill="currentColor" fillRule="nonzero" />
                    </g>
                  </svg>
                ) : null}
              </Button>
              <div style={{ height: targetFrame.layout.nameGap }} />
              {editingGlyphId === cell.glyph.id ? (
                <GlyphNameInput
                  ref={editingInputRef}
                  glyph={cell.glyph}
                  onFinished={(nextName) => {
                    if (nextName) onPendingGlyphName(cell.glyph.id, nextName);
                    setEditingGlyphId(null);
                  }}
                />
              ) : canAuthor ? (
                <Button
                  aria-label={`Rename ${cell.glyph.displayName}`}
                  variant="ghost"
                  className="h-7 w-full truncate bg-input px-2 text-center font-ui text-xs font-normal text-muted hover:bg-hover"
                  onClick={() => setEditingGlyphId(cell.glyph.id)}
                >
                  {cell.glyph.displayName}
                </Button>
              ) : (
                <div className="flex h-7 w-full items-center justify-center truncate bg-input px-2 text-xs text-muted">
                  {cell.glyph.displayName}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
