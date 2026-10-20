import { useEffect, useRef } from "react";
import type { Editor } from "@shift/editor";
import { effect, track } from "@shift/editor/signals";
import type { GlyphId } from "@shift/types";
import { useEditor } from "@/workspace/WorkspaceContext";
import { fillGlyph, previewGlyph } from "./previewGlyphs";

/** The thumbnail's square size, in CSS pixels. */
const THUMBNAIL_PX = 22;

/**
 * A glyph's outline at the active source or location, fitted into a square.
 *
 * @param size - The square's side in CSS pixels; small by default, for lists.
 */
export function GlyphThumbnail({
  glyphId,
  size = THUMBNAIL_PX,
}: {
  readonly glyphId: GlyphId;
  readonly size?: number;
}) {
  const editor = useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const subscription = effect(() => drawThumbnail(canvas, editor, glyphId, size));
    return () => subscription.dispose();
  }, [editor, glyphId, size]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className="shrink-0 text-primary"
    />
  );
}

/**
 * Draws one glyph centred on its advance, baseline at a fixed height, into a
 * thumbnail canvas; inside an effect it reruns on the glyph's signals. Draws
 * nothing until the glyph is loaded.
 */
export function drawThumbnail(
  canvas: HTMLCanvasElement,
  editor: Editor,
  glyphId: GlyphId,
  size: number = THUMBNAIL_PX,
): void {
  track(editor.font.metricsCell);
  const glyph = previewGlyph(editor, glyphId);
  // The canvas may sit in a tool window, whose pixel ratio and styles are its own.
  const view = canvas.ownerDocument.defaultView ?? window;
  const ratio = view.devicePixelRatio || 1;
  canvas.width = Math.round(size * ratio);
  canvas.height = Math.round(size * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx || !glyph) return;

  const scale = (size * 0.75) / editor.font.metricsCell.peek().unitsPerEm;
  const x = (size - glyph.advance * scale) / 2;
  const baseline = size * 0.78;
  ctx.fillStyle = view.getComputedStyle(canvas).color;
  fillGlyph(ctx, glyph.path, x, baseline, scale, ratio, 1);
}
