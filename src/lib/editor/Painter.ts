import {
  DEFAULT_STYLES,
  GUIDE_STYLES,
  HANDLE_STYLES,
  SELECTION_RECTANGLE_STYLES,
} from "@/lib/styles/style";
import { IPath, IRenderer } from "@/types/graphics";

import { ContourNode } from "./ContourManager";

const HANDLE_SHAPES = {
  corner: {
    size: 5,
  },
  control: {
    radius: 2.5,
  },
  smooth: {
    radius: 2.5,
  },
  direction: {
    size: 8,
  },
} as const;

export class Painter {
  public drawGuides(ctx: IRenderer, path: IPath) {
    ctx.setStyle(GUIDE_STYLES);
    ctx.stroke(path);
  }

  public drawContours(ctx: IRenderer, nodes: ContourNode[]): void {
    ctx.setStyle(DEFAULT_STYLES);
    for (const node of nodes) {
      ctx.stroke(node.renderPath);
    }
  }

  public drawCornerHandle(ctx: IRenderer, x: number, y: number): void {
    ctx.strokeRect(
      x - HANDLE_SHAPES.corner.size / 2,
      y - HANDLE_SHAPES.corner.size / 2,
      HANDLE_SHAPES.corner.size,
      HANDLE_SHAPES.corner.size,
    );
  }

  public drawControlHandle(ctx: IRenderer, x: number, y: number): void {
    ctx.strokeCircle(x, y, HANDLE_SHAPES.control.radius);
  }

  public drawDirectionHandle(ctx: IRenderer, x: number, y: number): void {}

  public drawHandles(ctx: IRenderer, nodes: ContourNode[]): void {
    for (const node of nodes) {
      const points = node.contour.points();
      for (const point of points) {
        switch (point.type) {
          case "onCurve":
            ctx.setStyle(HANDLE_STYLES.corner);
            this.drawCornerHandle(ctx, point.x, point.y);
            break;
          case "offCurve":
            ctx.setStyle(HANDLE_STYLES.control);
            this.drawControlHandle(ctx, point.x, point.y);
            break;
        }
      }
    }
  }

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
