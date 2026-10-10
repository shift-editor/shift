import type { Editor } from "@shift/editor";
import { track } from "@shift/editor/signals";
import type { GlyphId } from "@shift/types";

/** A glyph's outline and advance at the active source or location, in font units. */
export interface PreviewGlyph {
  readonly path: Path2D;
  readonly advance: number;
}

/** The glyph at the active source or location; subscribes to its outline and advance. */
export function previewGlyph(editor: Editor, glyphId: GlyphId): PreviewGlyph | null {
  const model = editor
    .glyphForId(glyphId)
    ?.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell);
  if (!model) return null;
  track(model.svgPathCell);
  track(model.xAdvanceCell);
  return { path: model.drawPath, advance: model.xAdvance };
}

/** Fills `path` with its origin at `x` on `baseline`, in CSS pixels, y up. */
export function fillGlyph(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  x: number,
  baseline: number,
  scale: number,
  ratio: number,
  alpha: number,
): void {
  ctx.setTransform(scale * ratio, 0, 0, -scale * ratio, x * ratio, baseline * ratio);
  ctx.globalAlpha = alpha;
  ctx.fill(path);
}

export function glyphName(editor: Editor, glyphId: GlyphId): string {
  return editor.font.entryForId(glyphId)?.name ?? glyphId;
}
