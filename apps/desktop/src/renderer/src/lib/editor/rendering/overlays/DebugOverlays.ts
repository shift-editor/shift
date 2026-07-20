import type { Canvas } from "../Canvas";
import type { GlyphView } from "@/lib/model/Glyph";
import type { SegmentId } from "@/types/indicator";

export class DebugOverlays {
  draw(
    canvas: Canvas,
    view: GlyphView,
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
      this.#drawSegmentBounds(canvas, view, debug.segmentBounds);
    }
    if (overlays.tightBounds) {
      this.#drawTightBounds(canvas, view, hoveredSegmentId, debug.tightBounds);
    }
    if (overlays.hitRadii) {
      this.#drawHitRadii(canvas, view, hitRadiusUpm, debug.hitRadii);
    }
    if (overlays.glyphBbox) {
      this.#drawGlyphBbox(canvas, view, debug.glyphBbox);
    }
  }

  #drawSegmentBounds(canvas: Canvas, view: GlyphView, color: string): void {
    for (const contour of view.contours) {
      if (contour.component) continue;

      for (const segment of contour.segments()) {
        const b = segment.bounds;
        canvas.strokeRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y, color, 1);
      }
    }
  }

  #drawTightBounds(
    canvas: Canvas,
    view: GlyphView,
    hoveredSegmentId: SegmentId | null,
    color: string,
  ): void {
    if (hoveredSegmentId === null) return;
    for (const contour of view.contours) {
      if (contour.component) continue;

      for (const segment of contour.segments()) {
        if (segment.id !== hoveredSegmentId) continue;
        const b = segment.bounds;
        canvas.strokeRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y, color, 1);
        return;
      }
    }
  }

  #drawHitRadii(canvas: Canvas, view: GlyphView, hitRadiusUpm: number, color: string): void {
    const r = hitRadiusUpm * canvas.camera.upmScale * canvas.camera.zoom;
    for (const point of view.allPoints) {
      canvas.strokeCircle({ x: point.x, y: point.y }, r, color, 1);
    }
  }

  #drawGlyphBbox(canvas: Canvas, view: GlyphView, color: string): void {
    const b = view.bounds;
    if (!b) return;
    canvas.strokeRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y, color, 1);
  }
}
