/**
 * TextRunRenderer — stateless per-frame draw class for the active text run.
 *
 * Same shape as the indicator drawing classes (Anchors, BoundingBox, etc.):
 * no fields, methods take `(canvas, ...)`. The frame loop subscribes to the
 * relevant signals (textRun.layoutCell / caretCell / selectionRectsCell / interaction)
 * and re-draws when they change.
 *
 * Coordinate space note: scene layers draw in glyph-local UPM space after
 * `Canvas.withGlyphSpace()` applies the current `editor.drawOffset`. The
 * TextLayout, by contrast, holds glyph positions in world/scene UPM space —
 * same space that `event.point` arrives in via `coords.scene`.
 *
 * The renderer reverses the drawOffset translate once at the top, then
 * draws everything using world coords directly — same coords the layout
 * produced and the hit-test consumed.
 *
 * Draw order:
 *   1. selection rects (under glyphs)
 *   2. glyphs (fill + optional hover outline; the item being edited as a
 *      glyph is skipped — the editor draws that one separately at drawOffset)
 *   3. caret (over glyphs)
 */
import type { Canvas } from "./Canvas";
import type { Font } from "@/lib/model/Font";
import { TextRun, type FocusedGlyph } from "@/lib/text/TextRun";
import type { Point2D } from "@shift/geo";
import type { Signal } from "@/lib/signals/signal";
import type { AxisLocation } from "@/types/variation";
import { OutlineRenderer } from "./Outline";

export class Text {
  readonly #outlineRenderer = new OutlineRenderer();

  draw(
    canvas: Canvas,
    run: TextRun,
    font: Font,
    designLocation: Signal<AxisLocation>,
    drawOffset: Point2D,
    focusedGlyph: FocusedGlyph | null,
  ): void {
    const layout = run.layoutCell.peek();
    if (!layout) return;

    const theme = canvas.theme.textRun;

    canvas.save();
    // Reverse the drawOffset translate so we draw in world UPM space.
    canvas.translate(-drawOffset.x, -drawOffset.y);

    // Selection rects (under glyphs)
    for (const rect of run.selectionRectsCell.peek()) {
      canvas.fillRect(
        rect.x,
        rect.bottom,
        rect.width,
        rect.top - rect.bottom,
        theme.selectionFill,
      );
    }

    // Glyphs
    const focusedItemId =
      focusedGlyph?.anchor.runId === run.id ? focusedGlyph.anchor.itemId : null;
    const hoveredCluster = run.interaction.hoveredIndex;

    for (const line of layout.lines) {
      let runBase = layout.origin.x;
      for (const r of line.runs) {
        for (const g of r.glyphs) {
          // Skip the item being edited as a glyph — the editor draws that one
          // at its drawOffset via the standard glyph render path.
          if (focusedItemId && g.sourceItemIds.includes(focusedItemId)) {
            continue;
          }

          const glyph = font.glyph({ name: g.glyphName });
          if (!glyph) continue;

          const outline = glyph.instance(designLocation).render.outline;

          canvas.save();
          canvas.translate(
            runBase + g.origin.x + g.xOffset,
            line.y + g.origin.y + g.yOffset,
          );
          this.#outlineRenderer.draw(canvas, outline, {
            fill: canvas.theme.glyph.fill,
          });

          if (g.cluster === hoveredCluster) {
            this.#outlineRenderer.draw(canvas, outline, {
              stroke: {
                color: theme.hoverOutline,
                widthPx: theme.hoverOutlineWidthPx,
              },
            });
          }
          canvas.restore();
        }
        runBase += r.advance;
      }
    }

    // Caret (over glyphs)
    if (run.cursorVisible) {
      const caret = run.caretCell.peek();
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
