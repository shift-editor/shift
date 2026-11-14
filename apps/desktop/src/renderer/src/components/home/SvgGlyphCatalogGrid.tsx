import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@shift/ui";
import { GlyphContextMenu } from "./GlyphContextMenu";
import { GlyphCatalogLayout } from "./glyphCatalogLayout";
import { GlyphNameInput } from "./GlyphNameInput";
import { GlyphPreviewLayout } from "./GlyphPreviewLayout";
import { useCatalogSelection } from "./useCatalogSelection";
import { useGlyphPreviewFrame } from "./useGlyphPreviewFrame";
import { useRevealSelectedGlyph } from "./useRevealSelectedGlyph";
import type { GlyphId } from "@shift/types";
import type { SvgGlyphCatalogGridProps } from "@/types/glyphCatalog";

const PLAIN_CLICK = { range: false, toggle: false };

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
  selection,
  selectGlyphs,
  onPendingGlyphName,
  onFirstFrame,
  onUnavailable,
  glyphActionLabel,
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
  const selecting = useCatalogSelection({
    containerRef,
    layout,
    glyphs,
    selection,
    selectGlyphs,
    openGlyph,
  });
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

  useRevealSelectedGlyph({
    containerRef,
    layout,
    glyphs,
    selection,
    dragging: selecting.box !== null,
  });

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
    <GlyphContextMenu
      glyphAt={(event) => selecting.glyphAt(event.clientX, event.clientY)}
      selection={selection}
      selectGlyphs={selectGlyphs}
      openGlyph={openGlyph}
      renameGlyph={canAuthor ? (glyph) => setEditingGlyphId(glyph.id) : undefined}
    >
      <div
        ref={containerRef}
        aria-label="Glyph catalog"
        data-testid="glyph-catalog-svg"
        data-glyph-catalog-renderer="svg"
        data-grid-readiness={readiness}
        data-preview-cache-bytes={cacheBytes}
        data-first-glyph-name={glyphs[0]?.displayName}
        className="absolute inset-0 overflow-x-hidden overflow-y-auto outline-none"
        role="group"
        tabIndex={0}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onDoubleClick={(event) => {
          // A press captures the pointer, so its clicks arrive here, not on the glyph.
          const glyph = selecting.glyphAt(event.clientX, event.clientY);
          if (glyph) void handleOpenGlyph(glyph.id);
        }}
        {...selecting.handlers}
      >
        <div className="relative" style={{ height: layout.totalHeight, width: "100%" }}>
          {targetFrame.cells.map((cell) => {
            const preview = previews.get(cell.glyph.id);
            const previewLayout = preview
              ? new GlyphPreviewLayout(metrics, preview.xAdvance, cell.previewRect.height)
              : null;
            const top = cell.cellRect.top + targetFrame.scrollTop;
            let previewContent: ReactNode = null;
            if (preview?.svgPath && previewLayout) {
              previewContent = (
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
              );
            } else if (
              readiness === "Complete" &&
              previews.has(cell.glyph.id) &&
              cell.glyph.unicode !== null
            ) {
              previewContent = (
                <span aria-hidden="true" className="font-sans text-3xl text-muted">
                  {String.fromCodePoint(cell.glyph.unicode)}
                </span>
              );
            }

            let nameCell = (
              <div className="flex h-7 w-full items-center justify-center truncate bg-input px-2 text-xs text-muted">
                {cell.glyph.displayName}
              </div>
            );
            if (canAuthor) {
              nameCell = (
                <Button
                  aria-label={`Rename ${cell.glyph.displayName}`}
                  variant="ghost"
                  className="h-7 w-full truncate bg-input px-2 text-center font-ui text-xs font-normal text-muted hover:bg-hover"
                  onClick={() => setEditingGlyphId(cell.glyph.id)}
                >
                  {cell.glyph.displayName}
                </Button>
              );
            }
            if (editingGlyphId === cell.glyph.id) {
              nameCell = (
                <GlyphNameInput
                  ref={editingInputRef}
                  glyph={cell.glyph}
                  onFinished={(nextName) => {
                    if (nextName) onPendingGlyphName(cell.glyph.id, nextName);
                    setEditingGlyphId(null);
                  }}
                />
              );
            }

            return (
              <div
                key={cell.glyph.id}
                data-glyph-id={cell.glyph.id}
                className="absolute flex flex-col"
                style={{
                  height: cell.cellRect.height,
                  left: cell.cellRect.left,
                  top,
                  width: cell.cellRect.width,
                }}
              >
                <Button
                  aria-label={glyphActionLabel?.(cell.glyph) ?? `Open ${cell.glyph.displayName}`}
                  variant="ghost"
                  aria-pressed={selection.has(cell.glyph.id)}
                  isActive={selection.has(cell.glyph.id)}
                  className="flex w-full items-center justify-center overflow-hidden p-0 hover:bg-hover"
                  style={{ height: cell.previewRect.height }}
                  // The pointer selects on press; this is the keyboard's Enter and Space.
                  onClick={(event) => {
                    if (event.detail === 0)
                      selectGlyphs(selection.click(cell.glyph.id, PLAIN_CLICK));
                  }}
                >
                  {previewContent}
                </Button>
                {selection.has(cell.glyph.id) ? (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 rounded outline-2 outline-offset-2 outline-accent"
                    style={{ height: cell.previewRect.height }}
                  />
                ) : null}
                <div style={{ height: targetFrame.layout.nameGap }} />
                {nameCell}
              </div>
            );
          })}
          {selecting.box ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute border border-accent bg-accent/10"
              style={{
                height: selecting.box.height,
                left: selecting.box.left,
                top: selecting.box.top,
                width: selecting.box.width,
              }}
            />
          ) : null}
        </div>
      </div>
    </GlyphContextMenu>
  );
}
