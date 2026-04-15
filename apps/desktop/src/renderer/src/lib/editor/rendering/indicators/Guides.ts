import type { FontMetrics } from "@shift/types";
import type { Canvas } from "../Canvas";

export class Guides {
  draw(canvas: Canvas, metrics: FontMetrics, advance: number): void {
    const { color, widthPx } = canvas.theme.guides;
    const lw = canvas.pxToUpm(widthPx);

    canvas.ctx.save();
    canvas.ctx.strokeStyle = color;
    canvas.ctx.lineWidth = lw;
    canvas.ctx.setLineDash([]);
    canvas.ctx.beginPath();

    // Horizontal metric lines
    for (const y of [
      metrics.ascender,
      metrics.capHeight ?? 0,
      metrics.xHeight ?? 0,
      0, // baseline
      metrics.descender,
    ]) {
      canvas.ctx.moveTo(0, y);
      canvas.ctx.lineTo(advance, y);
    }

    // Vertical sidebearing lines
    canvas.ctx.moveTo(0, metrics.descender);
    canvas.ctx.lineTo(0, metrics.ascender);
    canvas.ctx.moveTo(advance, metrics.descender);
    canvas.ctx.lineTo(advance, metrics.ascender);

    canvas.ctx.stroke();
    canvas.ctx.restore();
  }
}
