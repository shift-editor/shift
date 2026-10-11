import { useEffect, useRef } from "react";
import type { Editor } from "@shift/editor";
import { effect, track } from "@shift/editor/signals";
import type { GlyphId } from "@shift/types";
import { useEditor } from "@/workspace/WorkspaceContext";
import { fillGlyph, previewGlyph } from "./previewGlyphs";

/** The thumbnail's square size, in CSS pixels. */
const THUMBNAIL_PX = 22;

/** A glyph's outline at the active source or location, fitted into a small square. */
export function GlyphThumbnail({ glyphId }: { readonly glyphId: GlyphId }) {
  const editor = useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const subscription = effect(() => drawThumbnail(canvas, editor, glyphId));
    return () => subscription.dispose();
  }, [editor, glyphId]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      width={THUMBNAIL_PX}
      height={THUMBNAIL_PX}
      className="size-5.5 shrink-0 text-primary"
    />
  );
}

/** Draws one glyph centred on its advance, baseline at a fixed height; reruns on its signals. */
function drawThumbnail(canvas: HTMLCanvasElement, editor: Editor, glyphId: GlyphId): void {
  track(editor.font.metricsCell);
  const glyph = previewGlyph(editor, glyphId);
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(THUMBNAIL_PX * ratio);
  canvas.height = Math.round(THUMBNAIL_PX * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx || !glyph) return;

  const scale = (THUMBNAIL_PX * 0.75) / editor.font.metricsCell.peek().unitsPerEm;
  const x = (THUMBNAIL_PX - glyph.advance * scale) / 2;
  const baseline = THUMBNAIL_PX * 0.78;
  ctx.fillStyle = getComputedStyle(canvas).color;
  fillGlyph(ctx, glyph.path, x, baseline, scale, ratio, 1);
}
