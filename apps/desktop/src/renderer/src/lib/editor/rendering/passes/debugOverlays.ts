import type { Glyph } from "@shift/types";
import type { SegmentId } from "@/types/indicator";
import type { RenderContext } from "./types";
import { Segment } from "@/lib/geo/Segment";
import { Glyphs } from "@shift/font";

const DEBUG_STROKE = "red";

export function renderDebugTightBounds(
  rc: RenderContext,
  glyph: Glyph,
  hoveredSegmentId: SegmentId | null,
): void {
  if (hoveredSegmentId === null) return;

  for (const { segment } of Segment.iterateGlyph(glyph.contours)) {
    if (Segment.id(segment) !== hoveredSegmentId) continue;

    const bounds = Segment.bounds(segment);
    const width = bounds.max.x - bounds.min.x;
    const height = bounds.max.y - bounds.min.y;

    rc.ctx.strokeStyle = DEBUG_STROKE;
    rc.ctx.lineWidth = rc.lineWidthUpm();
    rc.ctx.strokeRect(bounds.min.x, bounds.min.y, width, height);
    return;
  }
}

export function renderDebugHitRadii(rc: RenderContext, glyph: Glyph, hitRadiusUpm: number): void {
  rc.ctx.strokeStyle = DEBUG_STROKE;
  rc.ctx.lineWidth = rc.lineWidthUpm();

  for (const { point } of Glyphs.points(glyph)) {
    rc.ctx.strokeCircle(point.x, point.y, hitRadiusUpm);
  }
}

export function renderDebugSegmentBounds(rc: RenderContext, glyph: Glyph): void {
  rc.ctx.strokeStyle = DEBUG_STROKE;
  rc.ctx.lineWidth = rc.lineWidthUpm();

  for (const { segment } of Segment.iterateGlyph(glyph.contours)) {
    const bounds = Segment.bounds(segment);
    const width = bounds.max.x - bounds.min.x;
    const height = bounds.max.y - bounds.min.y;
    rc.ctx.strokeRect(bounds.min.x, bounds.min.y, width, height);
  }
}
