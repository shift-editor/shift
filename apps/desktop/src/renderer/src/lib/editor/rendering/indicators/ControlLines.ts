import type { Canvas } from "../Canvas";
import type { Glyph } from "@/lib/model/Glyph";
import { Validate } from "@shift/validation";

/**
 * Draws tether lines connecting off-curve control points to their on-curve anchors.
 * Uses direct index iteration (no generator) for 70K-point glyph perf.
 */
export class ControlLines {
  draw(
    canvas: Canvas,
    glyph: Glyph,
    isLineVisible?: (from: { x: number; y: number }, to: { x: number; y: number }) => boolean,
  ): void {
    const { stroke, widthPx } = canvas.theme.glyph;
    const lw = canvas.pxToUpm(widthPx);

    canvas.ctx.save();
    canvas.ctx.strokeStyle = stroke;
    canvas.ctx.lineWidth = lw;
    canvas.ctx.setLineDash([]);
    canvas.ctx.beginPath();
    let hasLines = false;

    for (const contour of glyph.contours) {
      const points = contour.points;
      const len = points.length;
      if (len === 0) continue;

      for (let i = 0; i < len; i++) {
        const current = points[i]!;
        if (!Validate.isOffCurve(current)) continue;

        const next = i + 1 < len ? points[i + 1] : contour.closed ? points[0] : undefined;
        const prev = i > 0 ? points[i - 1] : contour.closed ? points[len - 1] : undefined;

        const anchor = next && Validate.isOffCurve(next) ? prev : next;
        if (!anchor || Validate.isOffCurve(anchor)) continue;
        if (isLineVisible && !isLineVisible(anchor, current)) continue;

        canvas.ctx.moveTo(anchor.x, anchor.y);
        canvas.ctx.lineTo(current.x, current.y);
        hasLines = true;
      }
    }

    if (hasLines) {
      canvas.ctx.stroke();
    }
    canvas.ctx.restore();
  }
}
