import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { GlyphCatalogController } from "./GlyphCatalogController";
import { GlyphNameInput } from "./GlyphNameInput";
import { useTheme } from "@/context/ThemeContext";
import type {
  GlyphCatalogCanvasProps,
  GlyphCatalogItem,
  PendingGlyphNames,
} from "@/types/glyphCatalog";
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
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<GlyphCatalogController | null>(null);
  const [ready, setReady] = useState(false);
  const [editingGlyph, setEditingGlyph] = useState<GlyphCatalogItem | null>(null);
  const [pendingGlyphNames, setPendingGlyphNames] = useState<PendingGlyphNames>(() => new Map());

  useLayoutEffect(() => {
    const container = containerRef.current;
    const glyphCanvas = glyphCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!container || !glyphCanvas || !overlayCanvas) return undefined;

    const controller = new GlyphCatalogController(
      container,
      glyphCanvas,
      overlayCanvas,
      atlasSource,
      observeAtlasInvalidation,
      canAuthor
        ? (glyph) => {
            setEditingGlyph(glyph);
          }
        : null,
      () => {
        inputRef.current?.blur();
        setEditingGlyph(null);
      },
      openGlyph,
      (nextReady) => {
        setReady(nextReady);
        if (nextReady) onFirstFrame();
      },
      onUnavailable,
    );
    controllerRef.current = controller;

    return () => {
      controllerRef.current = null;
      controller.destroy();
    };
  }, [
    atlasSource,
    canAuthor,
    containerRef,
    observeAtlasInvalidation,
    onFirstFrame,
    onUnavailable,
    openGlyph,
  ]);

  useLayoutEffect(() => {
    controllerRef.current?.update(
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
  }, [active, editingGlyph, glyphs, location, metrics, pendingGlyphNames, sourceId, themeName]);

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
        data-first-glyph-name={
          glyphs[0] ? (pendingGlyphNames.get(glyphs[0].id) ?? glyphs[0].displayName) : undefined
        }
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
