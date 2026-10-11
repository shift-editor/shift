import type { GlyphOutline } from "../../../types/glyphRender";
import type { Canvas } from "./Canvas";

export interface OutlineStroke {
  readonly color: string;
  readonly widthPx: number;
}

/** A glyph's contours split by whether they enclose an area. */
export interface DisplayOutline {
  readonly closedContoursPath: Path2D;
  readonly openContoursPath: Path2D;
}

export interface DisplayOutlineStyle {
  readonly fill: string;
  readonly stroke: string;
  readonly widthPx: number;
}

export interface OutlineDrawOptions {
  readonly fill?: string | null;
  readonly stroke?: OutlineStroke | null;
}

/** Draws glyph outline parts with canvas styling chosen by the caller. */
export class OutlineRenderer {
  draw(canvas: Canvas, view: GlyphOutline, options: OutlineDrawOptions): void {
    const path = view.drawPath;
    if (options.fill) canvas.fillPath(path, options.fill);
    if (options.stroke) canvas.strokePath(path, options.stroke.color, options.stroke.widthPx);
  }

  /** Draws a glyph as display text: closed contours filled, open ones stroked, no gap filled. */
  drawDisplay(canvas: Canvas, view: DisplayOutline, style: DisplayOutlineStyle): void {
    canvas.fillPath(view.closedContoursPath, style.fill);
    canvas.strokePath(view.openContoursPath, style.stroke, style.widthPx);
  }
}
