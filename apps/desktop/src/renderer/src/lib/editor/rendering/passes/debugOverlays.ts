import type { Glyph } from "@shift/types";
import type { Bounds } from "@shift/geo";
import type { SegmentId } from "@/types/indicator";
import { Bounds as BoundsUtil } from "@shift/geo";
import type { RenderContext } from "./types";
import { Segment } from "@/lib/geo/Segment";
import { Glyphs } from "@shift/font";

const COLOR_TIGHT_BOUNDS = "red";
const COLOR_HIT_RADII = "#2196F3";
const COLOR_SEGMENT_BOUNDS = "#FF9800";
const COLOR_GLYPH_BBOX = "#FF00FB";

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

    rc.ctx.strokeStyle = COLOR_TIGHT_BOUNDS;
    rc.ctx.lineWidth = rc.lineWidthUpm();
    rc.ctx.strokeRect(bounds.min.x, bounds.min.y, width, height);
    return;
  }
}

export function renderDebugHitRadii(rc: RenderContext, glyph: Glyph, hitRadiusUpm: number): void {
  rc.ctx.strokeStyle = COLOR_HIT_RADII;
  rc.ctx.lineWidth = rc.lineWidthUpm();

  for (const { point } of Glyphs.points(glyph)) {
    rc.ctx.strokeCircle(point.x, point.y, hitRadiusUpm);
  }
}

export function renderDebugSegmentBounds(rc: RenderContext, glyph: Glyph): void {
  rc.ctx.strokeStyle = COLOR_SEGMENT_BOUNDS;
  rc.ctx.lineWidth = rc.lineWidthUpm();

  for (const { segment } of Segment.iterateGlyph(glyph.contours)) {
    const bounds = Segment.bounds(segment);
    const width = bounds.max.x - bounds.min.x;
    const height = bounds.max.y - bounds.min.y;
    rc.ctx.strokeRect(bounds.min.x, bounds.min.y, width, height);
  }
}

export function renderDebugGlyphBbox(rc: RenderContext, glyph: Glyph): void {
  let bbox: Bounds | null = null;
  for (const { segment } of Segment.iterateGlyph(glyph.contours)) {
    const sb = Segment.bounds(segment);
    bbox = bbox ? BoundsUtil.union(bbox, sb) : sb;
  }
  if (!bbox) return;

  const width = bbox.max.x - bbox.min.x;
  const height = bbox.max.y - bbox.min.y;

  rc.ctx.strokeStyle = COLOR_GLYPH_BBOX;
  rc.ctx.lineWidth = rc.lineWidthUpm();
  rc.ctx.strokeRect(bbox.min.x, bbox.min.y, width, height);
}
