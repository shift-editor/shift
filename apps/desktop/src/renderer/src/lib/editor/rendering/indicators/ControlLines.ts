import type { Canvas } from "../Canvas";
import type { Glyph } from "@/lib/model/Glyph";
import { Contours } from "@shift/font";
import { Validate } from "@shift/validation";

/**
 * Draws tether lines connecting off-curve control points to their on-curve anchors.
 * Renders on the 2D scene layer.
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
      for (const { current, prev, next } of Contours.withNeighbors(contour)) {
        if (!Validate.isOffCurve(current)) continue;

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
