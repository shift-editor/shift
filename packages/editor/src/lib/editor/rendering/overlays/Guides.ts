import type { GlyphGuideMetrics } from "../../../../types/glyphRender";
import { LOCK_GAP_PX, LOCK_PATH_DATA, LOCK_SIZE_PX, LOCK_VIEW_BOX_SIZE } from "../icons/lock";
import type { Canvas } from "../Canvas";

let lockPath: Path2D | null = null;

function getLockPath(): Path2D {
  lockPath ??= new Path2D(LOCK_PATH_DATA);
  return lockPath;
}

export class Guides {
  draw(canvas: Canvas, metrics: GlyphGuideMetrics, advance: number, readOnly: boolean): void {
    const { color, widthPx } = canvas.theme.guides;

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

    canvas.stroke(color, widthPx);

    if (readOnly) this.#drawLock(canvas, metrics.descender, advance);
  }

  /** Draws the lock icon centred under the descender line, sized in screen pixels. */
  #drawLock(canvas: Canvas, descender: number, advance: number): void {
    const anchor = canvas.toScreen({ x: advance / 2, y: descender });
    const scale = LOCK_SIZE_PX / LOCK_VIEW_BOX_SIZE;

    canvas.withScreenSpace(() => {
      canvas.ctx.save();
      canvas.ctx.translate(anchor.x - LOCK_SIZE_PX / 2, anchor.y + LOCK_GAP_PX);
      canvas.ctx.scale(scale, scale);
      canvas.ctx.fillStyle = canvas.theme.readOnlyLock.color;
      canvas.ctx.fill(getLockPath());
      canvas.ctx.restore();
    });
  }
}
