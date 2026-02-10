/**
 * Segment highlight render pass -- overlays hovered or selected curve segments
 * with distinct stroke styles so the user can see which segment is targeted.
 *
 * Operates in UPM space. Each segment is individually re-stroked on top of
 * the base glyph outline using thicker / coloured styles.
 */

import type { IRenderer } from "@/types/graphics";
import type { Glyph } from "@shift/types";
import type { SegmentId } from "@/types/indicator";
import { Segment } from "@/lib/geo/Segment";
import { SEGMENT_HOVER_STYLE, SEGMENT_SELECTED_STYLE } from "@/lib/styles/style";
import type { RenderContext } from "./types";

/**
 * Highlights hovered and selected segments in the glyph.
 * Skips work entirely when nothing is hovered and no segments are selected.
 */
export function renderSegmentHighlights(
  rc: RenderContext,
  glyph: Glyph,
  hoveredId: SegmentId | null,
  isSelected: (segmentId: SegmentId) => boolean,
): void {
  if (!hoveredId && !hasAnySelectedSegment(glyph, isSelected)) return;

  for (const { segment } of Segment.iterateGlyph(glyph.contours)) {
    const segmentId = Segment.id(segment);
    const isHovered = hoveredId === segmentId;
    const selected = isSelected(segmentId);

    if (!isHovered && !selected) continue;

    const style = selected ? SEGMENT_SELECTED_STYLE : SEGMENT_HOVER_STYLE;
    rc.ctx.setStyle(style);
    rc.ctx.lineWidth = rc.lineWidthUpm(style.lineWidth);

    drawSegmentCurve(rc.ctx, segment);
  }
}

function hasAnySelectedSegment(
  glyph: Glyph,
  isSelected: (segmentId: SegmentId) => boolean,
): boolean {
  for (const { segment } of Segment.iterateGlyph(glyph.contours)) {
    if (isSelected(Segment.id(segment))) return true;
  }
  return false;
}

function drawSegmentCurve(ctx: IRenderer, segment: ReturnType<typeof Segment.parse>[number]): void {
  const curve = Segment.toCurve(segment);
  ctx.beginPath();
  ctx.moveTo(curve.p0.x, curve.p0.y);

  switch (curve.type) {
    case "line":
      ctx.lineTo(curve.p1.x, curve.p1.y);
      break;
    case "quadratic":
      ctx.quadTo(curve.c.x, curve.c.y, curve.p1.x, curve.p1.y);
      break;
    case "cubic":
      ctx.cubicTo(curve.c0.x, curve.c0.y, curve.c1.x, curve.c1.y, curve.p1.x, curve.p1.y);
      break;
  }

  ctx.stroke();
}
