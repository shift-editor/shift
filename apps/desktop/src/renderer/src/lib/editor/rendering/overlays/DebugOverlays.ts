import type { Canvas } from "../Canvas";
import type { GlyphInstanceGeometry } from "@/lib/model/Glyph";
import type { SegmentId } from "@/types/indicator";

export class DebugOverlays {
  draw(
    canvas: Canvas,
    geometry: GlyphInstanceGeometry,
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
      this.#drawSegmentBounds(canvas, geometry, debug.segmentBounds);
    }
    if (overlays.tightBounds) {
      this.#drawTightBounds(canvas, geometry, hoveredSegmentId, debug.tightBounds);
    }
    if (overlays.hitRadii) {
      this.#drawHitRadii(canvas, geometry, hitRadiusUpm, debug.hitRadii);
    }
    if (overlays.glyphBbox) {
      this.#drawGlyphBbox(canvas, geometry, debug.glyphBbox);
    }
  }

  #drawSegmentBounds(canvas: Canvas, geometry: GlyphInstanceGeometry, color: string): void {
    for (const contour of geometry.contours) {
      for (const segment of contour.segments()) {
        const b = segment.bounds;
        canvas.strokeRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y, color, 1);
      }
    }
  }

  #drawTightBounds(
    canvas: Canvas,
    geometry: GlyphInstanceGeometry,
    hoveredSegmentId: SegmentId | null,
    color: string,
  ): void {
    if (hoveredSegmentId === null) return;
    for (const contour of geometry.contours) {
      for (const segment of contour.segments()) {
        if (segment.id !== hoveredSegmentId) continue;
        const b = segment.bounds;
        canvas.strokeRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y, color, 1);
        return;
      }
    }
  }

  #drawHitRadii(
    canvas: Canvas,
    geometry: GlyphInstanceGeometry,
    hitRadiusUpm: number,
    color: string,
  ): void {
    const r = hitRadiusUpm * canvas.camera.upmScale * canvas.camera.zoom;
    for (const point of geometry.allPoints) {
      canvas.strokeCircle({ x: point.x, y: point.y }, r, color, 1);
    }
  }

  #drawGlyphBbox(canvas: Canvas, geometry: GlyphInstanceGeometry, color: string): void {
    const b = geometry.bounds;
    if (!b) return;
    canvas.strokeRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y, color, 1);
  }
}
