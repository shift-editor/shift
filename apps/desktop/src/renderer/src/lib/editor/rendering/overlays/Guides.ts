import type { GlyphGuideMetrics } from "@/types/glyphRender";
import {
  LOCK_COLOR,
  LOCK_GAP_PX,
  LOCK_PATH_DATA,
  LOCK_SIZE_PX,
  LOCK_VIEW_BOX_SIZE,
} from "../icons/lock";
import type { Canvas } from "../Canvas";
const LOCK_PATH = new Path2D(LOCK_PATH_DATA);

export class Guides {
  draw(canvas: Canvas, metrics: GlyphGuideMetrics, advance: number, readOnly: boolean): void {
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

    if (readOnly) this.#drawLock(canvas, metrics.descender, advance);
  }

  #drawLock(canvas: Canvas, descender: number, advance: number): void {
    const size = canvas.pxToUpm(LOCK_SIZE_PX);
    const gap = canvas.pxToUpm(LOCK_GAP_PX);

    canvas.ctx.save();
    canvas.ctx.translate((advance - size) / 2, descender - gap);
    canvas.ctx.scale(size / LOCK_VIEW_BOX_SIZE, -size / LOCK_VIEW_BOX_SIZE);
    canvas.ctx.fillStyle = LOCK_COLOR;
    canvas.ctx.fill(LOCK_PATH);
    canvas.ctx.restore();
  }
}
