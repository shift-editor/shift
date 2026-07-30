import { useLayoutEffect, useRef, useState } from "react";
import { GlyphCatalogController } from "./GlyphCatalogController";
import { GlyphNameInput } from "./GlyphNameInput";
import { useTheme } from "@/context/ThemeContext";
import type { GlyphCatalogCanvasProps, GlyphCatalogItem } from "@/types/glyphCatalog";
import { useEditor } from "@/workspace/WorkspaceContext";

/** Thin React shell around the imperative, canvas-owned glyph catalog. */
export function GlyphCatalogCanvas({
  containerRef,
  glyphs,
  location,
  axes,
  metrics,
  sourceId,
  active,
  openGlyph,
  onFirstFrame,
  onUnavailable,
}: GlyphCatalogCanvasProps) {
  const editor = useEditor();
  const { themeName } = useTheme();
  const glyphCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<GlyphCatalogController | null>(null);
  const [ready, setReady] = useState(false);
  const [editingGlyph, setEditingGlyph] = useState<GlyphCatalogItem | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const glyphCanvas = glyphCanvasRef.current;
    const overlayCanvas = overlayCanvasRef.current;
    if (!container || !glyphCanvas || !overlayCanvas) return undefined;

    const controller = new GlyphCatalogController(
      container,
      glyphCanvas,
      overlayCanvas,
      editor.font,
      setEditingGlyph,
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
  }, [containerRef, editor.font, onFirstFrame, onUnavailable, openGlyph]);

  useLayoutEffect(() => {
    controllerRef.current?.update(
      {
        glyphs,
        location,
        axes,
        metrics,
        sourceId,
        themeName,
        active,
        editingGlyphId: editingGlyph?.id ?? null,
      },
      inputContainerRef.current,
    );
  }, [active, axes, editingGlyph, glyphs, location, metrics, sourceId, themeName]);

  useLayoutEffect(() => {
    if (!editingGlyph) return;

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editingGlyph]);

  return (
    <>
      <canvas
        ref={glyphCanvasRef}
        aria-hidden="true"
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
            onFinished={() => setEditingGlyph(null)}
          />
        </div>
      ) : null}
    </>
  );
}
