import type { GlyphOutline } from "@/lib/model/GlyphOutline";
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
  draw(
    canvas: Canvas,
    outline: GlyphOutline,
    options: OutlineDrawOptions,
  ): void {
    const path = outline.drawPath;
    if (options.fill) canvas.fillPath(path, options.fill);
    if (options.stroke)
      canvas.strokePath(path, options.stroke.color, options.stroke.widthPx);
  }
}
