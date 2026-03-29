/**
 * Segment highlight render pass -- overlays hovered or selected curve segments
 * with distinct stroke styles so the user can see which segment is targeted.
 *
 * Operates in UPM space. Each segment is individually re-stroked on top of
 * the base glyph outline using thicker / coloured styles.
 */

import type { IRenderer } from "@/types/graphics";
import type { Segment as SegmentType } from "@/types/segments";
import { Segment } from "@/lib/geo/Segment";
import { SEGMENT_HOVER_STYLE, SEGMENT_SELECTED_STYLE } from "@/lib/styles/style";
import type { RenderContext } from "./types";

/**
 * Highlights hovered and selected segments in the glyph.
 * Skips work entirely when nothing is hovered and no segments are selected.
 */
export function renderSegmentHighlights(
  rc: RenderContext,
  hoveredSegment: SegmentType | null,
  selectedSegments: readonly SegmentType[],
): void {
  if (!hoveredSegment && selectedSegments.length === 0) return;

  if (selectedSegments.length > 0) {
    rc.applyStyle(SEGMENT_SELECTED_STYLE);
    rc.ctx.beginPath();
    for (const segment of selectedSegments) {
      appendSegmentCurve(rc.ctx, segment);
    }
    rc.ctx.stroke();
  }
  if (
    hoveredSegment &&
    !selectedSegments.some((segment) => Segment.id(segment) === Segment.id(hoveredSegment))
  ) {
    rc.applyStyle(SEGMENT_HOVER_STYLE);
    rc.ctx.beginPath();
    appendSegmentCurve(rc.ctx, hoveredSegment);
    rc.ctx.stroke();
  }
}

function appendSegmentCurve(ctx: IRenderer, segment: SegmentType): void {
  const curve = Segment.toCurve(segment);
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
}
