import type { GlyphRenderModel } from "@/lib/model/Glyph";
import type { Canvas } from "./Canvas";

export interface OutlineStroke {
  readonly color: string;
  readonly widthPx: number;
}

export interface OutlineDrawOptions {
  readonly fill?: string | null;
  readonly stroke?: OutlineStroke | null;
}

/** Draws glyph outline parts with canvas styling chosen by the caller. */
export class OutlineRenderer {
  draw(canvas: Canvas, view: GlyphRenderModel, options: OutlineDrawOptions): void {
    const path = view.drawPath;
    if (options.fill) canvas.fillPath(path, options.fill);
    if (options.stroke) canvas.strokePath(path, options.stroke.color, options.stroke.widthPx);
  }
}
