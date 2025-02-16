import {
  GUIDE_STYLES,
  SELECTION_RECTANGLE_STYLES,
} from "@/lib/gfx/styles/style";
import { IPath, IRenderer } from "@/types/graphics";

import { Contour } from "../core/Contour";

export class Painter {
  public drawMetrics(ctx: IRenderer, path: IPath) {
    ctx.setStyle(GUIDE_STYLES);
    ctx.stroke(path);
  }

  public drawContour(ctx: IRenderer, contour: Contour): void {
    ctx.setStyle(GUIDE_STYLES);
  }

  public drawInteractive(_: IRenderer): void {}

  public drawSelectionRectangle(
    ctx: IRenderer,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const rx = x;
    const ry = y;
    const rw = w;
    const rh = h;

    ctx.setStyle({
      ...SELECTION_RECTANGLE_STYLES,
      strokeStyle: "transparent",
    });
    ctx.fillRect(rx, ry, rw, rh);

    // Stroke second
    ctx.setStyle({
      ...SELECTION_RECTANGLE_STYLES,
      fillStyle: "transparent",
    });
    ctx.strokeRect(rx, ry, rw, rh);
  }
}
