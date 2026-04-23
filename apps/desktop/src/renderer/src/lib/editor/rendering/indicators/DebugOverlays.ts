import type { Canvas } from "../Canvas";
import type { Glyph } from "@/lib/model/Glyph";
import type { SegmentId } from "@/types/indicator";

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
    for (const { segment } of glyph.segments()) {
      const b = segment.bounds;
      canvas.strokeRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y, color, 1);
    }
  }

  #drawTightBounds(
    canvas: Canvas,
    glyph: Glyph,
    hoveredSegmentId: SegmentId | null,
    color: string,
  ): void {
    if (hoveredSegmentId === null) return;
    for (const { segment } of glyph.segments()) {
      if (segment.id !== hoveredSegmentId) continue;
      const b = segment.bounds;
      canvas.strokeRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y, color, 1);
      return;
    }
  }

  #drawHitRadii(canvas: Canvas, glyph: Glyph, hitRadiusUpm: number, color: string): void {
    const r = hitRadiusUpm * canvas.viewport.upmScale * canvas.viewport.zoom;
    for (const point of glyph.allPoints) {
      canvas.strokeCircle({ x: point.x, y: point.y }, r, color, 1);
    }
  }

  #drawGlyphBbox(canvas: Canvas, glyph: Glyph, color: string): void {
    const b = glyph.bbox;
    if (!b) return;
    canvas.strokeRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y, color, 1);
  }
}
