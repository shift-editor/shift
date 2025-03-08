import { IRenderer } from "@/types/graphics";

import { Path2D } from "../graphics/Path";
import { HANDLE_STYLES } from "../styles/style";

export class Painter {
  public drawGuides(ctx: IRenderer, path: Path2D) {
    ctx.stroke(path);
  }

  public drawCornerHandle(ctx: IRenderer, x: number, y: number): void {
    ctx.setStyle(HANDLE_STYLES.corner.idle);
    ctx.strokeRect(
      x - HANDLE_STYLES.corner.idle.size / 2,
      y - HANDLE_STYLES.corner.idle.size / 2,
      HANDLE_STYLES.corner.idle.size,
      HANDLE_STYLES.corner.idle.size,
    );
  }

  public drawHoveredCornerHandle(ctx: IRenderer, x: number, y: number): void {
    ctx.setStyle(HANDLE_STYLES.corner.hovered);
    ctx.strokeRect(
      x - HANDLE_STYLES.corner.hovered.size / 2,
      y - HANDLE_STYLES.corner.hovered.size / 2,
      HANDLE_STYLES.corner.hovered.size,
      HANDLE_STYLES.corner.hovered.size,
    );
    ctx.fillRect(
      x - HANDLE_STYLES.corner.hovered.size / 2,
      y - HANDLE_STYLES.corner.hovered.size / 2,
      HANDLE_STYLES.corner.hovered.size,
      HANDLE_STYLES.corner.hovered.size,
    );
  }

  public drawSelectedCornerHandle(ctx: IRenderer, x: number, y: number): void {
    ctx.setStyle(HANDLE_STYLES.corner.selected);
    ctx.fillRect(
      x - HANDLE_STYLES.corner.selected.size / 2,
      y - HANDLE_STYLES.corner.selected.size / 2,
      HANDLE_STYLES.corner.selected.size,
      HANDLE_STYLES.corner.selected.size,
    );
  }

  public drawControlHandle(ctx: IRenderer, x: number, y: number): void {
    ctx.setStyle(HANDLE_STYLES.control.idle);
    ctx.strokeCircle(x, y, HANDLE_STYLES.control.idle.size);
    ctx.fillCircle(x, y, HANDLE_STYLES.control.idle.size);
  }

  public drawSelectedControlHandle(ctx: IRenderer, x: number, y: number): void {
    ctx.setStyle(HANDLE_STYLES.control.selected);
    ctx.fillCircle(x, y, HANDLE_STYLES.control.selected.size);
  }

  public drawDirectionHandle(ctx: IRenderer, x: number, y: number): void {
    const size = HANDLE_STYLES.direction.idle.size;
    ctx.setStyle(HANDLE_STYLES.direction.idle);
    ctx.beginPath();
    ctx.moveTo(x - size, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x - size, y + size);
    ctx.closePath();
    ctx.stroke();
  }

  public drawHoveredDirectionHandle(
    ctx: IRenderer,
    x: number,
    y: number,
  ): void {
    const size = HANDLE_STYLES.direction.hovered.size;
    ctx.setStyle(HANDLE_STYLES.direction.hovered);
    ctx.beginPath();
    ctx.moveTo(x - size, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x - size, y + size);
    ctx.closePath();
    ctx.stroke();
  }

  public drawSelectedDirectionHandle(
    ctx: IRenderer,
    x: number,
    y: number,
  ): void {
    const size = HANDLE_STYLES.direction.selected.size;
    ctx.setStyle(HANDLE_STYLES.direction.selected);

    ctx.beginPath();
    ctx.moveTo(x - size, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x - size, y + size);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }

  public drawBoundingRect() {}
}
