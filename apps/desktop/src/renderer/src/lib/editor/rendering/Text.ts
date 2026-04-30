/**
 * TextRunRenderer — stateless per-frame draw class for the active text run.
 *
 * Same shape as the indicator drawing classes (Anchors, BoundingBox, etc.):
 * no fields, methods take `(canvas, ...)`. The frame loop subscribes to the
 * relevant signals (textRun.$layout / $caret / $selectionRects / interaction)
 * and re-draws when they change.
 *
 * Coordinate space note: the canvas inside `renderToolScene` has been
 * translated by `editor.drawOffset` (Viewport.ts:174) so that `glyph.draw`
 * for the active glyph lands at world `drawOffset`. The TextLayout, by
 * contrast, holds glyph positions in *world* (scene) UPM space — same space
 * that `event.point` arrives in via `coords.scene`.
 *
 * The renderer reverses the drawOffset translate once at the top, then
 * draws everything using world coords directly — same coords the layout
 * produced and the hit-test consumed.
 *
 * Draw order:
 *   1. selection rects (under glyphs)
 *   2. glyphs (fill + optional hover outline; the cell being edited as a
 *      glyph is skipped — the editor draws that one separately at drawOffset)
 *   3. caret (over glyphs)
 */
import type { Canvas } from "./Canvas";
import type { Font } from "@/lib/model/Font";
import { TextRun, type FocusedGlyph } from "@/lib/text/TextRun";
import type { Point2D } from "@shift/types";

export class Text {
  draw(
    canvas: Canvas,
    run: TextRun,
    font: Font,
    drawOffset: Point2D,
    focusedGlyph: FocusedGlyph | null,
  ): void {
    const layout = run.$layout.peek();
    if (!layout) return;

    const theme = canvas.theme.textRun;

    canvas.save();
    // Reverse the drawOffset translate so we draw in world UPM space.
    canvas.translate(-drawOffset.x, -drawOffset.y);

    // Selection rects (under glyphs)
    for (const rect of run.$selectionRects.peek()) {
      canvas.fillRect(rect.x, rect.bottom, rect.width, rect.top - rect.bottom, theme.selectionFill);
    }

    // Glyphs
    const focusedCellId = focusedGlyph?.anchor.runId === run.id ? focusedGlyph.anchor.cellId : null;
    const hoveredCluster = run.interaction.hoveredIndex;

    for (const line of layout.lines) {
      let runBase = layout.origin.x;
      for (const r of line.runs) {
        for (const g of r.glyphs) {
          // Skip the cell being edited as a glyph — the editor draws that one
          // at its drawOffset via the standard glyph render path.
          if (focusedCellId && g.cellIds.includes(focusedCellId)) {
            continue;
          }

          // GlyphView.$path is a cached Path2D — only re-built when the
          // variation location moves (or the glyph's geometry changes).
          // The Editor's staticEffect already tracks $variationLocation
          // and requests a scene redraw, so peek() is correct here.
          const view = font.glyph(g.glyphName);
          if (view) {
            const path = view.$path.peek();
            canvas.save();
            canvas.translate(runBase + g.origin.x + g.xOffset, line.y + g.origin.y + g.yOffset);
            canvas.fillPath(path, canvas.theme.glyph.fill);
            if (g.cluster === hoveredCluster) {
              canvas.strokePath(path, theme.hoverOutline, theme.hoverOutlineWidthPx);
            }
            canvas.restore();
          }
        }
        runBase += r.advance;
      }
    }

    // Caret (over glyphs)
    if (run.cursorVisible) {
      const caret = run.$caret.peek();
      if (caret) {
        const pos = caret.position();
        const top = pos.y + layout.metrics.ascender;
        const bottom = pos.y + layout.metrics.descender;
        canvas.line(
          { x: pos.x, y: top },
          { x: pos.x, y: bottom },
          theme.cursorColor,
          theme.cursorWidthPx,
        );
      }
    }

    canvas.restore();
  }
}
