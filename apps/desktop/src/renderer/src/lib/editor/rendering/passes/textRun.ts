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
import type { Contour, RenderContour } from "@shift/types";
import { buildContourPath } from "../render";
import type { CompositeComponentsPayload } from "@shared/bridge/FontEngineAPI";

const CURSOR_COLOR = "#0C92F4";
const CURSOR_WIDTH_PX = 1.25;
const CURSOR_BAR_HALF_PX = 20;
const HOVER_OUTLINE = "#0C92F4";
const HOVER_OUTLINE_WIDTH_PX = 3;
const COMPOSITE_ARM_FILL = "rgba(128, 128, 128, 0.22)";
const COMPOSITE_ARM_METRICS_STROKE = "rgba(108, 108, 108, 0.9)";
const COMPOSITE_ARM_METRICS_WIDTH_PX = 2;
const COMPONENT_OVERLAY_COLORS = [
  "rgba(169, 236, 183, 0.26)",
  "rgba(255, 182, 207, 0.26)",
] as const;
const COMPONENT_OVERLAY_HOVER_COLORS = [
  "rgba(124, 220, 150, 0.4)",
  "rgba(255, 151, 186, 0.4)",
] as const;

interface LiveGlyphRenderData {
  glyphName?: string;
  unicode?: number;
  contours: readonly Contour[];
  compositeContours: readonly RenderContour[];
}

export interface CompositeInspectionRenderData {
  slotIndex: number;
  hoveredComponentIndex: number | null;
  components: CompositeComponentsPayload["components"];
}

export function renderTextRun(
  rc: RenderContext,
  textRun: TextRunState,
  metrics: FontMetrics,
  liveGlyph?: LiveGlyphRenderData | null,
  inspection?: CompositeInspectionRenderData | null,
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

    if (shouldUseLiveGlyph && liveGlyph) {
      ctx.beginPath();
      for (const contour of liveGlyph.contours) {
        buildContourPath(ctx, contour);
      }
      for (const contour of liveGlyph.compositeContours) {
        buildContourPath(ctx, contour);
      }
      ctx.fill();
    } else if (slot.svgPath) {
      const path = GlyphRenderCache.get(slot.glyph.glyphName, slot.svgPath);
      ctx.fillPath(path);
    }

    ctx.restore();
  }

  renderCompositeInspection(rc, layout, metrics, inspection);

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
        for (const contour of liveGlyph!.compositeContours) {
          buildContourPath(ctx, contour);
        }
        ctx.stroke();
      } else if (slot.svgPath) {
        const path = GlyphRenderCache.get(slot.glyph.glyphName, slot.svgPath);
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

function renderCompositeInspection(
  rc: RenderContext,
  layout: TextRunState["layout"],
  metrics: FontMetrics,
  inspection?: CompositeInspectionRenderData | null,
): void {
  if (!inspection) return;
  const slot = layout.slots[inspection.slotIndex];
  if (!slot) return;
  const { ctx, lineWidthUpm } = rc;

  ctx.save();
  ctx.translate(slot.x, 0);

  if (slot.svgPath) {
    const path = GlyphRenderCache.get(slot.glyph.glyphName, slot.svgPath);
    ctx.fillStyle = COMPOSITE_ARM_FILL;
    ctx.fillPath(path);
  }

  for (let i = 0; i < inspection.components.length; i++) {
    const component = inspection.components[i];
    const palette = i % 2;
    ctx.fillStyle =
      inspection.hoveredComponentIndex === i
        ? COMPONENT_OVERLAY_HOVER_COLORS[palette]
        : COMPONENT_OVERLAY_COLORS[palette];
    ctx.beginPath();
    for (const contour of component.contours) {
      buildContourPath(ctx, contour);
    }
    ctx.fill();
  }

  const lw = lineWidthUpm(COMPOSITE_ARM_METRICS_WIDTH_PX);
  ctx.strokeStyle = COMPOSITE_ARM_METRICS_STROKE;
  ctx.lineWidth = lw;
  ctx.beginPath();
  const width = Math.max(slot.advance, 1);
  ctx.moveTo(0, metrics.descender);
  ctx.lineTo(width, metrics.descender);
  ctx.lineTo(width, metrics.ascender);
  ctx.lineTo(0, metrics.ascender);
  ctx.closePath();
  ctx.stroke();

  ctx.restore();
}

function isLiveGlyphSlot(
  slot: { glyph: { glyphName: string }; unicode: number | null },
  liveGlyph?: LiveGlyphRenderData | null,
): boolean {
  const slotGlyphName = slot.glyph.glyphName;
  const liveUnicode = (liveGlyph as { unicode?: number } | null | undefined)?.unicode;
  return (
    liveGlyph !== null &&
    liveGlyph !== undefined &&
    (liveGlyph.glyphName === slotGlyphName ||
      (typeof liveUnicode === "number" && slot.unicode !== null && slot.unicode === liveUnicode)) &&
    liveGlyph.contours.length + liveGlyph.compositeContours.length > 0
  );
}
