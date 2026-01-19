import type { IRenderer } from "@/types/graphics";

import { ARROW_ANGLE } from "./constants";

export function drawFilledCircle(
  ctx: IRenderer,
  x: number,
  y: number,
  r: number,
): void {
  ctx.fillCircle(x, y, r);
}

export function drawStrokedCircle(
  ctx: IRenderer,
  x: number,
  y: number,
  r: number,
): void {
  ctx.strokeCircle(x, y, r);
}

export function drawFilledRect(
  ctx: IRenderer,
  x: number,
  y: number,
  size: number,
): void {
  ctx.fillRect(x - size / 2, y - size / 2, size, size);
}

export function drawStrokedRect(
  ctx: IRenderer,
  x: number,
  y: number,
  size: number,
): void {
  ctx.strokeRect(x - size / 2, y - size / 2, size, size);
}

export function drawArrowHead(
  ctx: IRenderer,
  x: number,
  y: number,
  angle: number,
  size: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(
    x - size * Math.cos(angle + ARROW_ANGLE),
    y - size * Math.sin(angle + ARROW_ANGLE),
  );
  ctx.moveTo(x, y);
  ctx.lineTo(
    x - size * Math.cos(angle - ARROW_ANGLE),
    y - size * Math.sin(angle - ARROW_ANGLE),
  );
  ctx.stroke();
}

export function drawDirectionArrow(
  ctx: IRenderer,
  x: number,
  y: number,
  direction: "up" | "down",
  size: number,
): void {
  const sign = direction === "up" ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(
    x - size * Math.cos(ARROW_ANGLE),
    y + sign * size * Math.sin(ARROW_ANGLE),
  );
  ctx.moveTo(x, y);
  ctx.lineTo(
    x + size * Math.cos(ARROW_ANGLE),
    y + sign * size * Math.sin(ARROW_ANGLE),
  );
  ctx.stroke();
}
