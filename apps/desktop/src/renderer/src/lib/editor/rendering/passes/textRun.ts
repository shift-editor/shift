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
import { getGuides, renderGuides } from ".";
import { GUIDE_STYLES } from "@/lib/styles/style";

const CURSOR_COLOR = "#0C92F4";
const CURSOR_WIDTH_PX = 1.25;
const CURSOR_BAR_HALF_PX = 20;
const HOVER_OUTLINE = "#0C92F4";
const HOVER_OUTLINE_WIDTH_PX = 3;
const COMPOSITE_ARM_FILL = "rgba(128, 128, 128, 0.22)";
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
  const { ctx, pxToUpm } = rc;
  const { layout, editingIndex, hoveredIndex, cursorX } = textRun;

  // Draw filled glyph silhouettes
  for (const [i, slot] of layout.slots.entries()) {
    if (i === editingIndex) continue;

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
      const lw = pxToUpm(HOVER_OUTLINE_WIDTH_PX);

      ctx.save();
      ctx.translate(slot.x, 0);
      ctx.strokeStyle = HOVER_OUTLINE;
      ctx.lineWidth = lw;

      if (shouldUseLiveGlyph && liveGlyph) {
        ctx.beginPath();
        for (const contour of liveGlyph.contours) {
          buildContourPath(ctx, contour);
        }
        for (const contour of liveGlyph.compositeContours) {
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
    const lw = pxToUpm(CURSOR_WIDTH_PX);
    const barHalf = pxToUpm(CURSOR_BAR_HALF_PX);

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
  const { ctx, applyStyle } = rc;

  ctx.save();
  ctx.translate(slot.x, 0);

  if (slot.svgPath) {
    const path = GlyphRenderCache.get(slot.glyph.glyphName, slot.svgPath);
    ctx.fillStyle = COMPOSITE_ARM_FILL;
    ctx.fillPath(path);
  }

  for (const [i, component] of inspection.components.entries()) {
    const palette = i % 2 === 0 ? 0 : 1;
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

  applyStyle(GUIDE_STYLES);
  const guides = getGuides(slot.advance, metrics);
  renderGuides(ctx, guides);

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
