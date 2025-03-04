import { IRenderer } from "@/types/graphics";

import { Path2D } from "../graphics/Path";
import { DEFAULT_STYLES } from "../styles/style";

const SELECTED_HANDLE_SCALE = 2;
const HANDLE_SIZES = {
  corner: {
    size: 6,
  },
  control: {
    radius: 3,
  },
  smooth: {
    radius: 2.5,
  },
  direction: {
    size: 12,
  },
} as const;

export class Painter {
  public drawGuides(ctx: IRenderer, path: Path2D) {
    ctx.stroke(path);
  }

  public drawCornerHandle(ctx: IRenderer, x: number, y: number): void {
    ctx.strokeRect(
      x - HANDLE_SIZES.corner.size / 2,
      y - HANDLE_SIZES.corner.size / 2,
      HANDLE_SIZES.corner.size,
      HANDLE_SIZES.corner.size,
    );
  }

  public drawSelectedCornerHandle(ctx: IRenderer, x: number, y: number): void {
    ctx.fillRect(
      x - (HANDLE_SIZES.corner.size * SELECTED_HANDLE_SCALE) / 2,
      y - (HANDLE_SIZES.corner.size * SELECTED_HANDLE_SCALE) / 2,
      HANDLE_SIZES.corner.size * SELECTED_HANDLE_SCALE,
      HANDLE_SIZES.corner.size * SELECTED_HANDLE_SCALE,
    );
  }

  public drawControlHandle(ctx: IRenderer, x: number, y: number): void {
    ctx.strokeCircle(x, y, HANDLE_SIZES.control.radius);
  }

  public drawSelectedControlHandle(ctx: IRenderer, x: number, y: number): void {
    ctx.fillCircle(
      x,
      y,
      HANDLE_SIZES.control.radius * SELECTED_HANDLE_SCALE * 0.75,
    );
  }

  public drawDirectionHandle(ctx: IRenderer, x: number, y: number): void {
    const size = HANDLE_SIZES.direction.size;
    const halfSize = size / 2;

    ctx.beginPath();
    ctx.moveTo(x - halfSize, y - halfSize);
    ctx.lineTo(x + halfSize, y);
    ctx.lineTo(x - halfSize, y + halfSize);
    ctx.closePath();
    ctx.stroke();
  }

  public drawSelectedDirectionHandle(
    ctx: IRenderer,
    x: number,
    y: number,
  ): void {
    const size = HANDLE_SIZES.direction.size * SELECTED_HANDLE_SCALE;
    const halfSize = size / 2;

    ctx.beginPath();
    ctx.moveTo(x - halfSize, y - halfSize);
    ctx.lineTo(x + halfSize, y);
    ctx.lineTo(x - halfSize, y + halfSize);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }
}
