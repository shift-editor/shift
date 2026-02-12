/**
 * Text run render pass — draws filled glyph silhouettes for the text run,
 * a cursor line, and hover highlights.
 *
 * Operates in UPM space. Slots whose index matches `editingIndex` are
 * skipped (that glyph is rendered by the normal glyph pipeline via drawOffset).
 */
import type { FontMetrics } from "@shift/types";
import type { RenderContext } from "./types";
import type { TextRunState } from "../../managers/TextRunManager";
import { GlyphRenderCache } from "@/lib/cache/GlyphRenderCache";
import type { Contour } from "@shift/types";
import { buildContourPath } from "../render";

const CURSOR_COLOR = "#0C92F4";
const CURSOR_WIDTH_PX = 1.25;
const CURSOR_BAR_HALF_PX = 20;
const HOVER_OUTLINE = "#0C92F4";
const HOVER_OUTLINE_WIDTH_PX = 3;

interface LiveGlyphRenderData {
  unicode: number;
  contours: readonly Contour[];
}

export function renderTextRun(
  rc: RenderContext,
  textRun: TextRunState,
  metrics: FontMetrics,
  liveGlyph?: LiveGlyphRenderData | null,
): void {
  const { ctx, lineWidthUpm } = rc;
  const { layout, editingIndex, hoveredIndex, cursorX } = textRun;

  // Draw filled glyph silhouettes
  for (let i = 0; i < layout.slots.length; i++) {
    if (i === editingIndex) continue;

    const slot = layout.slots[i];

    const shouldUseLiveGlyph = isLiveGlyphSlot(slot, liveGlyph);

    ctx.save();
    ctx.translate(slot.x, 0);
    ctx.fillStyle = "black";

    if (shouldUseLiveGlyph) {
      ctx.beginPath();
      for (const contour of liveGlyph.contours) {
        buildContourPath(ctx, contour);
      }
      ctx.fill();
    } else if (slot.svgPath) {
      const path = GlyphRenderCache.get(slot.unicode, slot.svgPath);
      ctx.fillPath(path);
    }

    ctx.restore();
  }

  // Draw hover highlight
  if (hoveredIndex !== null && hoveredIndex !== editingIndex) {
    const slot = layout.slots[hoveredIndex];
    if (slot) {
      const shouldUseLiveGlyph = isLiveGlyphSlot(slot, liveGlyph);
      const lw = lineWidthUpm(HOVER_OUTLINE_WIDTH_PX);

      ctx.save();
      ctx.translate(slot.x, 0);
      ctx.strokeStyle = HOVER_OUTLINE;
      ctx.lineWidth = lw;

      if (shouldUseLiveGlyph) {
        ctx.beginPath();
        for (const contour of liveGlyph!.contours) {
          buildContourPath(ctx, contour);
        }
        ctx.stroke();
      } else if (slot.svgPath) {
        const path = GlyphRenderCache.get(slot.unicode, slot.svgPath);
        ctx.strokePath(path);
      }

      ctx.restore();
    }
  }

  // Draw cursor
  if (cursorX !== null) {
    const top = metrics.ascender;
    const bottom = metrics.descender;
    const lw = lineWidthUpm(CURSOR_WIDTH_PX);
    const barHalf = lineWidthUpm(CURSOR_BAR_HALF_PX);

    ctx.save();
    ctx.strokeStyle = CURSOR_COLOR;
    ctx.lineWidth = lw;

    // Vertical line
    ctx.drawLine(cursorX, bottom, cursorX, top);

    // Top bar
    ctx.drawLine(cursorX - barHalf, top, cursorX + barHalf, top);

    // Bottom bar
    ctx.drawLine(cursorX - barHalf, bottom, cursorX + barHalf, bottom);

    ctx.restore();
  }
}

function isLiveGlyphSlot(
  slot: { unicode: number },
  liveGlyph?: LiveGlyphRenderData | null,
): boolean {
  return (
    liveGlyph !== null &&
    liveGlyph !== undefined &&
    liveGlyph.unicode === slot.unicode &&
    liveGlyph.contours.length > 0
  );
}
