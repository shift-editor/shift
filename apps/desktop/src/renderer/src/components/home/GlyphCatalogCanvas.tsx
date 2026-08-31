import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { SlugGlyphCatalogRenderer } from "./SlugGlyphCatalogRenderer";
import { SvgGlyphCatalogRenderer } from "./SvgGlyphCatalogRenderer";
import { selectGlyphCatalogRenderer } from "./selectGlyphCatalogRenderer";
import { GlyphNameInput } from "./GlyphNameInput";
import { useTheme } from "@/context/ThemeContext";
import type {
  GlyphCatalogCanvasProps,
  GlyphCatalogItem,
  PendingGlyphNames,
} from "@/types/glyphCatalog";
import type { GlyphCatalogRenderer, GlyphCatalogRendererKind } from "@/types/glyphCatalogRenderer";
import { useFontSession } from "@/workspace/WorkspaceContext";
import { effect, track } from "@/lib/signals";

/** Thin React shell around the imperative, canvas-owned glyph catalog. */
export function GlyphCatalogCanvas({
  containerRef,
  glyphs,
  location,
  metrics,
  sourceId,
  active,
  atlasSource,
  observeAtlasInvalidation,
  glyphPreviews,
  canAuthor,
  openGlyph,
  onFirstFrame,
  onUnavailable,
}: GlyphCatalogCanvasProps) {
  const { themeName } = useTheme();
  const session = useFontSession();
  const workspace = session.workspace;
  const editsSettled =
    useSyncExternalStore(
      (callback) => {
        if (!workspace) return () => {};

        const subscription = effect(() => {
          track(workspace.applyStatusCell);
          callback();
        });
        return () => subscription.dispose();
      },
      () => workspace?.applyStatusCell.peek() ?? "idle",
    ) === "idle";
  const glyphCanvasRef = useRef<HTMLCanvasElement>(null);
  const glyphSvgRef = useRef<SVGSVGElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rendererRef = useRef<GlyphCatalogRenderer | null>(null);
  const [rendererKind, setRendererKind] = useState<GlyphCatalogRendererKind | null>(null);
  const [ready, setReady] = useState(false);
  const [editingGlyph, setEditingGlyph] = useState<GlyphCatalogItem | null>(null);
  const [pendingGlyphNames, setPendingGlyphNames] = useState<PendingGlyphNames>(() => new Map());

  useLayoutEffect(() => {
    const container = containerRef.current;
    const glyphCanvas = glyphCanvasRef.current;
    const glyphSvg = glyphSvgRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!container || !glyphCanvas || !glyphSvg || !overlayCanvas) return undefined;
    const activeContainer = container;
    const activeGlyphCanvas = glyphCanvas;
    const activeGlyphSvg = glyphSvg;
    const activeOverlayCanvas = overlayCanvas;

    const abort = new AbortController();
    const onEditGlyph = canAuthor
      ? (glyph: GlyphCatalogItem) => {
          setEditingGlyph(glyph);
        }
      : null;
    const onEditingUnavailable = () => {
      inputRef.current?.blur();
      setEditingGlyph(null);
    };
    const onReadyChange = (nextReady: boolean) => {
      setReady(nextReady);
      if (nextReady) onFirstFrame();
    };

    async function selectRenderer(): Promise<void> {
      try {
        const selection = await selectGlyphCatalogRenderer(
          abort.signal,
          () =>
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
          () =>
            new SvgGlyphCatalogRenderer(
              activeContainer,
              activeGlyphSvg,
              activeOverlayCanvas,
              glyphPreviews,
              observeAtlasInvalidation,
              onEditGlyph,
              onEditingUnavailable,
              openGlyph,
              onReadyChange,
              onUnavailable,
            ),
        );
        if (abort.signal.aborted) {
          selection.renderer.destroy();
          return;
        }

        rendererRef.current = selection.renderer;
        setRendererKind(selection.kind);
      } catch (error) {
        if (!abort.signal.aborted) {
          console.error("glyph catalog renderer selection failed", error);
          onUnavailable();
        }
      }
    }

    void selectRenderer();
    return () => {
      abort.abort(new Error("glyph catalog renderer selection disposed"));
      const renderer = rendererRef.current;
      rendererRef.current = null;
      renderer?.destroy();
    };
  }, [
    atlasSource,
    canAuthor,
    containerRef,
    glyphPreviews,
    observeAtlasInvalidation,
    onFirstFrame,
    onUnavailable,
    openGlyph,
  ]);

  useLayoutEffect(() => {
    rendererRef.current?.update(
      {
        glyphs: glyphs.map((glyph) =>
          pendingGlyphNames.has(glyph.id)
            ? {
                ...glyph,
                name: pendingGlyphNames.get(glyph.id)!,
                displayName: pendingGlyphNames.get(glyph.id)!,
              }
            : glyph,
        ),
        location,
        metrics,
        sourceId,
        themeName,
        active,
        editingGlyphId: editingGlyph?.id ?? null,
      },
      inputContainerRef.current,
    );
  }, [
    active,
    editingGlyph,
    glyphs,
    location,
    metrics,
    pendingGlyphNames,
    rendererKind,
    sourceId,
    themeName,
  ]);

  useLayoutEffect(() => {
    if (!editingGlyph) return;

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editingGlyph]);

  useEffect(() => {
    if (pendingGlyphNames.size === 0) return;

    setPendingGlyphNames((current) => {
      const next = new Map(current);

      for (const [glyphId, pendingName] of current) {
        const visibleGlyph = glyphs.find(({ id }) => id === glyphId);
        const committedName = session.font.recordForId(glyphId)?.name;
        const visibleNameConfirmed =
          committedName === pendingName && (!visibleGlyph || visibleGlyph.name === pendingName);
        const renameRejected = editsSettled && committedName !== pendingName;
        if (visibleNameConfirmed || renameRejected) next.delete(glyphId);
      }

      return next.size === current.size ? current : next;
    });
  }, [editsSettled, glyphs, pendingGlyphNames, session.font]);

  return (
    <>
      <canvas
        ref={glyphCanvasRef}
        aria-hidden="true"
        data-testid="glyph-catalog-canvas"
        data-glyph-catalog-renderer="slug"
        data-first-glyph-name={
          glyphs[0] ? (pendingGlyphNames.get(glyphs[0].id) ?? glyphs[0].displayName) : undefined
        }
        className="pointer-events-none absolute left-0 top-0 z-[2] h-full w-full bg-transparent"
        style={{ visibility: ready && rendererKind === "slug" ? "visible" : "hidden" }}
      />
      <svg
        ref={glyphSvgRef}
        aria-hidden="true"
        data-testid="glyph-catalog-svg"
        data-glyph-catalog-renderer="svg"
        data-first-glyph-name={
          glyphs[0] ? (pendingGlyphNames.get(glyphs[0].id) ?? glyphs[0].displayName) : undefined
        }
        className="pointer-events-none absolute left-0 top-0 z-[2] h-full w-full overflow-hidden bg-transparent"
        style={{ visibility: ready && rendererKind === "svg" ? "visible" : "hidden" }}
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
              if (nextName) {
                setPendingGlyphNames((current) => new Map(current).set(editingGlyph.id, nextName));
              }
              setEditingGlyph((current) => (current?.id === editingGlyph.id ? null : current));
            }}
          />
        </div>
      ) : null}
    </>
  );
}
