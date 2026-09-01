import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { GlyphCatalogLayout } from "./glyphCatalogLayout";
import { GlyphNameInput } from "./GlyphNameInput";
import { selectGlyphCatalogRenderer } from "./selectGlyphCatalogRenderer";
import { SlugGlyphCatalogRenderer } from "./SlugGlyphCatalogRenderer";
import { useTheme } from "@/context/ThemeContext";
import type {
  GlyphCatalogControllerFrame,
  GlyphCatalogItem,
  SlugGlyphCatalogSurfaceProps,
} from "@/types/glyphCatalog";
import type { GlyphCatalogRenderer } from "@/types/glyphCatalogRenderer";

/** Owns the native scroll viewport and imperative surfaces required by Slug. */
export function SlugGlyphCatalogSurface({
  glyphs,
  location,
  metrics,
  sourceId,
  active,
  atlasSource,
  observeAtlasInvalidation,
  canAuthor,
  openGlyph,
  onPendingGlyphName,
  onSelected,
  onFallback,
  onFirstFrame,
  onUnavailable,
}: SlugGlyphCatalogSurfaceProps) {
  const { themeName } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const glyphCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rendererRef = useRef<GlyphCatalogRenderer | null>(null);
  const firstFramePublishedRef = useRef(false);
  const [[viewportWidth, viewportHeight], setViewportSize] = useState<
    readonly [width: number, height: number]
  >([0, 0]);
  const [ready, setReady] = useState(false);
  const [editingGlyph, setEditingGlyph] = useState<GlyphCatalogItem | null>(null);
  const controllerFrame = useMemo<GlyphCatalogControllerFrame>(
    () => ({
      glyphs,
      location,
      metrics,
      sourceId,
      themeName,
      active,
      editingGlyphId: editingGlyph?.id ?? null,
    }),
    [active, editingGlyph, glyphs, location, metrics, sourceId, themeName],
  );
  const controllerFrameRef = useRef(controllerFrame);
  controllerFrameRef.current = controllerFrame;
  const layout = useMemo(
    () => new GlyphCatalogLayout(viewportWidth, viewportHeight, glyphs.length),
    [glyphs.length, viewportHeight, viewportWidth],
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

  useLayoutEffect(() => {
    const container = containerRef.current;
    const glyphCanvas = glyphCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!container || !glyphCanvas || !overlayCanvas) return undefined;
    const activeContainer = container;
    const activeGlyphCanvas = glyphCanvas;
    const activeOverlayCanvas = overlayCanvas;

    const abort = new AbortController();
    const onEditGlyph = canAuthor ? (glyph: GlyphCatalogItem) => setEditingGlyph(glyph) : null;
    const onEditingUnavailable = () => {
      inputRef.current?.blur();
      setEditingGlyph(null);
    };
    const onReadyChange = (nextReady: boolean) => {
      setReady(nextReady);
      if (nextReady && !firstFramePublishedRef.current) {
        firstFramePublishedRef.current = true;
        onFirstFrame();
      }
    };

    async function initialize(): Promise<void> {
      try {
        const selection = await selectGlyphCatalogRenderer(abort.signal, () =>
          SlugGlyphCatalogRenderer.create(
            activeContainer,
            activeGlyphCanvas,
            activeOverlayCanvas,
            atlasSource,
            observeAtlasInvalidation,
            onEditGlyph,
            onEditingUnavailable,
            openGlyph,
            onReadyChange,
            onUnavailable,
            abort.signal,
          ),
        );
        if (abort.signal.aborted) {
          if (selection.kind === "slug") selection.renderer.destroy();
          return;
        }
        if (selection.kind === "svg") {
          onFallback();
          return;
        }

        rendererRef.current = selection.renderer;
        selection.renderer.update(controllerFrameRef.current, inputContainerRef.current);
        onSelected();
      } catch (error) {
        if (!abort.signal.aborted) {
          console.error("glyph catalog renderer selection failed", error);
          onUnavailable();
        }
      }
    }

    void initialize();
    return () => {
      abort.abort(new Error("glyph catalog renderer selection disposed"));
      const renderer = rendererRef.current;
      rendererRef.current = null;
      renderer?.destroy();
    };
  }, [
    atlasSource,
    canAuthor,
    observeAtlasInvalidation,
    onFallback,
    onFirstFrame,
    onSelected,
    onUnavailable,
    openGlyph,
  ]);

  useLayoutEffect(() => {
    rendererRef.current?.update(controllerFrame, inputContainerRef.current);
  }, [controllerFrame]);

  useLayoutEffect(() => {
    if (!editingGlyph) return;

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editingGlyph]);

  return (
    <>
      <div
        ref={containerRef}
        className="absolute inset-0 overflow-x-hidden overflow-y-auto"
        aria-label="Glyph catalog"
      >
        <div aria-hidden="true" style={{ height: layout.totalHeight, width: 1 }} />
      </div>
      <canvas
        ref={glyphCanvasRef}
        aria-hidden="true"
        data-testid="glyph-catalog-canvas"
        data-glyph-catalog-renderer="slug"
        data-first-glyph-name={glyphs[0]?.displayName}
        className="pointer-events-none absolute left-0 top-0 z-[2] h-full w-full bg-transparent"
        style={{ visibility: ready ? "visible" : "hidden" }}
      />
      <canvas
        ref={overlayCanvasRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 z-[1] h-full w-full bg-transparent"
      />
      {editingGlyph ? (
        <div
          ref={inputContainerRef}
          className="absolute left-0 top-0 z-[3]"
          style={{ height: 28, transform: "translate(-10000px, -10000px)", width: 0 }}
        >
          <GlyphNameInput
            ref={inputRef}
            glyph={editingGlyph}
            onFinished={(nextName) => {
              if (nextName) onPendingGlyphName(editingGlyph.id, nextName);
              setEditingGlyph((current) => (current?.id === editingGlyph.id ? null : current));
            }}
          />
        </div>
      ) : null}
    </>
  );
}
