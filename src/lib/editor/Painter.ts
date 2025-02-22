import { IPath, IRenderer } from "@/types/graphics";

const HANDLE_SHAPES = {
  corner: {
    size: 6,
  },
  control: {
    radius: 2.5,
  },
  smooth: {
    radius: 2.5,
  },
  direction: {
    size: 12,
  },
} as const;

export class Painter {
  public drawGuides(ctx: IRenderer, path: IPath) {
    ctx.stroke(path);
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

  public drawDirectionHandle(ctx: IRenderer, x: number, y: number): void {
    const size = HANDLE_SHAPES.direction.size;
    const halfSize = size / 2;

    ctx.beginPath();
    ctx.moveTo(x - halfSize, y - halfSize);
    ctx.lineTo(x + halfSize, y);
    ctx.lineTo(x - halfSize, y + halfSize);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
