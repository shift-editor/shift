import type { Canvas } from "../Canvas";
import type { Glyph } from "@/lib/model/Glyph";
import type { SegmentId } from "@/types/indicator";
import { Bounds as BoundsUtil, type Bounds } from "@shift/geo";
import { Segments } from "@/lib/geo/Segments";
import { Glyphs } from "@shift/font";

export class DebugOverlays {
  draw(
    canvas: Canvas,
    glyph: Glyph,
    overlays: {
      segmentBounds: boolean;
      tightBounds: boolean;
      hitRadii: boolean;
      glyphBbox: boolean;
    },
    hoveredSegmentId: SegmentId | null,
    hitRadiusUpm: number,
  ): void {
    const { debug } = canvas.theme;

    if (overlays.segmentBounds) {
      this.#drawSegmentBounds(canvas, glyph, debug.segmentBounds);
    }
    if (overlays.tightBounds) {
      this.#drawTightBounds(canvas, glyph, hoveredSegmentId, debug.tightBounds);
    }
    if (overlays.hitRadii) {
      this.#drawHitRadii(canvas, glyph, hitRadiusUpm, debug.hitRadii);
    }
    if (overlays.glyphBbox) {
      this.#drawGlyphBbox(canvas, glyph, debug.glyphBbox);
    }
  }

  #drawSegmentBounds(canvas: Canvas, glyph: Glyph, color: string): void {
    for (const { segment } of Segments.iterateGlyph(glyph.contours)) {
      const bounds = Segments.bounds(segment);
      const w = bounds.max.x - bounds.min.x;
      const h = bounds.max.y - bounds.min.y;
      canvas.strokeRect(bounds.min.x, bounds.min.y, w, h, color, 1);
    }
  }

  #drawTightBounds(
    canvas: Canvas,
    glyph: Glyph,
    hoveredSegmentId: SegmentId | null,
    color: string,
  ): void {
    if (hoveredSegmentId === null) return;
    for (const { segment } of Segments.iterateGlyph(glyph.contours)) {
      if (Segments.id(segment) !== hoveredSegmentId) continue;
      const bounds = Segments.bounds(segment);
      const w = bounds.max.x - bounds.min.x;
      const h = bounds.max.y - bounds.min.y;
      canvas.strokeRect(bounds.min.x, bounds.min.y, w, h, color, 1);
      return;
    }
  }

  #drawHitRadii(canvas: Canvas, glyph: Glyph, hitRadiusUpm: number, color: string): void {
    for (const { point } of Glyphs.points(glyph)) {
      canvas.strokeCircle(
        { x: point.x, y: point.y },
        hitRadiusUpm * canvas.viewport.upmScale * canvas.viewport.zoom,
        color,
        1,
      );
    }
  }

  #drawGlyphBbox(canvas: Canvas, glyph: Glyph, color: string): void {
    let bbox: Bounds | null = null;
    for (const { segment } of Segments.iterateGlyph(glyph.contours)) {
      const sb = Segments.bounds(segment);
      bbox = bbox ? BoundsUtil.union(bbox, sb) : sb;
    }
    if (!bbox) return;
    const w = bbox.max.x - bbox.min.x;
    const h = bbox.max.y - bbox.min.y;
    canvas.strokeRect(bbox.min.x, bbox.min.y, w, h, color, 1);
  }
}
