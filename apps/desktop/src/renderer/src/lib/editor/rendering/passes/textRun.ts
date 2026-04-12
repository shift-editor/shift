/**
 * Text run render pass — draws filled glyph silhouettes for the text run,
 * a cursor line, and hover highlights.
 *
 * Operates in UPM space. Slots whose index matches `editingIndex` are
 * skipped (that glyph is rendered by the normal glyph pipeline via drawOffset).
 *
 * Paths are resolved at render time via `font.getPath()` — always
 * fresh from Rust, no caching, no live/cached branching.
 */
import type { FontMetrics } from "@shift/types";
import type { RenderContext } from "./types";
import type { TextRunRenderState } from "@/lib/tools/text/TextRunController";
import { buildContourPath } from "../render";
import type { CompositeComponent } from "@shift/types";
import { getGuides, renderGuides } from ".";
import { GUIDE_STYLES } from "@/lib/styles/style";
import type { Font } from "@/lib/model/Font";

const CURSOR_COLOR = "#0C92F4";
const CURSOR_WIDTH_PX = 1.25;
const SELECTION_FILL = "rgba(12, 146, 244, 0.2)";
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

export interface CompositeInspectionRenderData {
  slotIndex: number;
  hoveredComponentIndex: number | null;
  components: readonly CompositeComponent[];
}

export function renderTextRun(
  rc: RenderContext,
  textRun: TextRunRenderState,
  metrics: FontMetrics,
  font: Font,
  inspection?: CompositeInspectionRenderData | null,
): void {
  const { ctx, pxToUpm } = rc;
  const { layout, editingIndex, hoveredIndex, cursorX } = textRun;

  for (const [i, slot] of layout.slots.entries()) {
    if (i === editingIndex) continue;

    if (!isSlotVisible(slot, metrics)) continue;

    const path = font.getPath(slot.glyph.glyphName);
    if (!path) continue;

    ctx.save();
    ctx.translate(slot.x, slot.y);
    ctx.fillStyle = "black";
    ctx.fillPath(path);
    ctx.restore();
  }

  if (textRun.selectionRects.length > 0) {
    ctx.save();
    ctx.fillStyle = SELECTION_FILL;
    for (const rect of textRun.selectionRects) {
      ctx.fillRect(rect.x, rect.bottom, rect.width, rect.top - rect.bottom);
    }
    ctx.restore();
  }

  renderCompositeInspection(rc, layout, metrics, font, inspection);

  if (hoveredIndex !== null && hoveredIndex !== editingIndex) {
    const slot = layout.slots[hoveredIndex];
    if (slot && isSlotVisible(slot, metrics)) {
      const path = font.getPath(slot.glyph.glyphName);
      if (path) {
        ctx.save();
        ctx.translate(slot.x, slot.y);
        ctx.strokeStyle = HOVER_OUTLINE;
        ctx.lineWidth = pxToUpm(HOVER_OUTLINE_WIDTH_PX);
        ctx.strokePath(path);
        ctx.restore();
      }
    }
  }

  if (cursorX !== null) {
    const cursorY = textRun.cursorY;
    const top = cursorY + metrics.ascender;
    const bottom = cursorY + metrics.descender;
    const lw = pxToUpm(CURSOR_WIDTH_PX);

    ctx.save();
    ctx.strokeStyle = CURSOR_COLOR;
    ctx.lineWidth = lw;
    ctx.drawLine(cursorX, bottom, cursorX, top);
    ctx.restore();
  }
}

function renderCompositeInspection(
  rc: RenderContext,
  layout: TextRunRenderState["layout"],
  metrics: FontMetrics,
  font: Font,
  inspection?: CompositeInspectionRenderData | null,
): void {
  if (!inspection) return;
  const slot = layout.slots[inspection.slotIndex];
  if (!slot) return;
  if (!isSlotVisible(slot, metrics)) return;
  const { ctx, applyStyle } = rc;

  ctx.save();
  ctx.translate(slot.x, slot.y);

  const armPath = font.getPath(slot.glyph.glyphName);
  if (armPath) {
    ctx.fillStyle = COMPOSITE_ARM_FILL;
    ctx.fillPath(armPath);
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

function isSlotVisible(
  slot: TextRunRenderState["layout"]["slots"][number],
  metrics: FontMetrics,
  visibleSceneBounds?: { minX: number; maxX: number; minY: number; maxY: number },
): boolean {
  if (!visibleSceneBounds) return true;

  const bounds = slot.bounds;
  const minX = slot.x + (bounds?.min.x ?? 0);
  const maxX = slot.x + (bounds?.max.x ?? Math.max(slot.advance, 0));
  const minY = slot.y + (bounds?.min.y ?? metrics.descender);
  const maxY = slot.y + (bounds?.max.y ?? metrics.ascender);

  return !(
    maxX < visibleSceneBounds.minX ||
    minX > visibleSceneBounds.maxX ||
    maxY < visibleSceneBounds.minY ||
    minY > visibleSceneBounds.maxY
  );
}
