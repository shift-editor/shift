import type { Canvas } from "../Canvas";
import type { GlyphRenderModel } from "../../../model/Glyph";
import type { PointType, SegmentId } from "@shift/types";
import type { ContourPoints, StrokeOutlinePreviewItem } from "@shift/wasm/protocol";
import { ContourPath } from "../../../graphics/ContourPath";

export class DebugOverlays {
  draw(
    canvas: Canvas,
    view: GlyphRenderModel,
    overlays: {
      segmentBounds: boolean;
      tightBounds: boolean;
      hitRadii: boolean;
      glyphBbox: boolean;
      strokePreview: boolean;
    },
    hoveredSegmentId: SegmentId | null,
    hitRadiusPx: number,
    strokePreviews: readonly StrokeOutlinePreviewItem[],
  ): void {
    const { debug } = canvas.theme;

    if (overlays.segmentBounds) {
      this.#drawSegmentBounds(canvas, view, debug.segmentBounds);
    }
    if (overlays.tightBounds) {
      this.#drawTightBounds(canvas, view, hoveredSegmentId, debug.tightBounds);
    }
    if (overlays.hitRadii) {
      this.#drawHitRadii(canvas, view, hitRadiusPx, debug.hitRadii);
    }
    if (overlays.glyphBbox) {
      this.#drawGlyphBbox(canvas, view, debug.glyphBbox);
    }
    if (overlays.strokePreview) {
      this.#drawStrokePreviews(canvas, strokePreviews, debug.strokePreview);
    }
  }

  #drawStrokePreviews(
    canvas: Canvas,
    previews: readonly StrokeOutlinePreviewItem[],
    color: string,
  ): void {
    for (const preview of previews) {
      for (const outline of preview.outlines) {
        canvas.fillPath(pathFromContourPoints(outline).path, color);
      }
    }
  }

  #drawSegmentBounds(canvas: Canvas, view: GlyphRenderModel, color: string): void {
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
    view: GlyphRenderModel,
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

  #drawHitRadii(canvas: Canvas, view: GlyphRenderModel, hitRadiusPx: number, color: string): void {
    for (const point of view.allPoints) {
      canvas.strokeCircle({ x: point.x, y: point.y }, hitRadiusPx, color, 1);
    }
  }

  #drawGlyphBbox(canvas: Canvas, view: GlyphRenderModel, color: string): void {
    const b = view.bounds;
    if (!b) return;
    canvas.strokeRect(b.min.x, b.min.y, b.max.x - b.min.x, b.max.y - b.min.y, color, 1);
  }
}

function pathFromContourPoints(contour: ContourPoints): ContourPath {
  const points = contour.pointTypes.map((pointType, index) => ({
    x: contour.coordinates[index * 2]!,
    y: contour.coordinates[index * 2 + 1]!,
    pointType: pointType as PointType,
    smooth: false,
  }));
  return ContourPath.fromPoints(points, contour.closed);
}
