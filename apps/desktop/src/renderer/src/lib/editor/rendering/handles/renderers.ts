import { HANDLE_STYLES } from "@/lib/styles/style";
import type { IRenderer } from "@/types/graphics";

export type HandleType =
  | "corner"
  | "smooth"
  | "control"
  | "direction"
  | "first"
  | "last";

export type HandleState = "idle" | "hovered" | "selected";

import {
  START_BAR_WIDTH,
  START_TRIANGLE_SIZE,
  START_TRIANGLE_GAP,
  END_BAR_WIDTH,
  END_TRIANGLE_SIZE,
} from "./constants";
import {
  drawFilledCircle,
  drawFilledRect,
  drawStrokedCircle,
  drawStrokedRect,
  drawHorizontalLine,
  drawTriangle,
} from "./primitives";

export interface HandleOptions {
  segmentAngle?: number;
}

export interface LastHandlePosition {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type HandleDrawFn = (
  ctx: IRenderer,
  x: number,
  y: number,
  state: HandleState,
  options?: HandleOptions,
) => void;

export type LastHandleDrawFn = (
  ctx: IRenderer,
  pos: LastHandlePosition,
  state: HandleState,
) => void;

export const drawFirstHandle: HandleDrawFn = (ctx, x, y, state, options) => {
  const style = HANDLE_STYLES.first[state];
  ctx.setStyle(style);

  const angle = options?.segmentAngle ?? 0;
  const perpAngle = angle + Math.PI / 2;

  drawHorizontalLine(ctx, x, y, START_BAR_WIDTH, perpAngle);

  const triangleX = x + Math.cos(angle) * (START_TRIANGLE_GAP + START_TRIANGLE_SIZE);
  const triangleY = y + Math.sin(angle) * (START_TRIANGLE_GAP + START_TRIANGLE_SIZE);
  drawTriangle(ctx, triangleX, triangleY, START_TRIANGLE_SIZE, angle);

  if (style.overlayColor) {
    ctx.fillStyle = style.overlayColor;
    ctx.strokeStyle = style.overlayColor;
    drawHorizontalLine(ctx, x, y, START_BAR_WIDTH, perpAngle);
    drawTriangle(ctx, triangleX, triangleY, START_TRIANGLE_SIZE, angle);
  }
};

export const drawCornerHandle: HandleDrawFn = (ctx, x, y, state) => {
  const style = HANDLE_STYLES.corner[state];
  ctx.setStyle(style);
  drawFilledRect(ctx, x, y, style.size);
  drawStrokedRect(ctx, x, y, style.size);

  if (style.overlayColor) {
    ctx.fillStyle = style.overlayColor;
    ctx.strokeStyle = style.overlayColor;
    drawFilledRect(ctx, x, y, style.size);
    drawStrokedRect(ctx, x, y, style.size);
  }
};

export const drawControlHandle: HandleDrawFn = (ctx, x, y, state) => {
  const style = HANDLE_STYLES.control[state];
  ctx.setStyle(style);
  drawStrokedCircle(ctx, x, y, style.size);
  drawFilledCircle(ctx, x, y, style.size);

  if (style.overlayColor) {
    ctx.fillStyle = style.overlayColor;
    ctx.strokeStyle = style.overlayColor;
    drawStrokedCircle(ctx, x, y, style.size);
    drawFilledCircle(ctx, x, y, style.size);
  }
};

export const drawSmoothHandle: HandleDrawFn = (ctx, x, y, state) => {
  const style = HANDLE_STYLES.smooth[state];
  ctx.setStyle(style);
  drawStrokedCircle(ctx, x, y, style.size);
  drawFilledCircle(ctx, x, y, style.size);

  if (style.overlayColor) {
    ctx.fillStyle = style.overlayColor;
    ctx.strokeStyle = style.overlayColor;
    drawStrokedCircle(ctx, x, y, style.size);
    drawFilledCircle(ctx, x, y, style.size);
  }
};

export const drawDirectionHandle: HandleDrawFn = (
  ctx,
  x,
  y,
  state,
  options,
) => {
  const style = HANDLE_STYLES.direction[state];
  ctx.setStyle(style);

  const angle = options?.segmentAngle ?? 0;
  drawTriangle(ctx, x, y, END_TRIANGLE_SIZE, angle);

  if (style.overlayColor) {
    ctx.fillStyle = style.overlayColor;
    ctx.strokeStyle = style.overlayColor;
    drawTriangle(ctx, x, y, END_TRIANGLE_SIZE, angle);
  }
};

export const drawLastHandle: LastHandleDrawFn = (ctx, pos, state) => {
  const style = HANDLE_STYLES.last[state];
  ctx.setStyle(style);

  const dx = pos.x1 - pos.x0;
  const dy = pos.y1 - pos.y0;
  const angle = Math.atan2(dy, dx);
  const perpAngle = angle + Math.PI / 2;

  drawHorizontalLine(ctx, pos.x0, pos.y0, END_BAR_WIDTH, perpAngle);

  if (style.overlayColor) {
    ctx.fillStyle = style.overlayColor;
    ctx.strokeStyle = style.overlayColor;
    drawHorizontalLine(ctx, pos.x0, pos.y0, END_BAR_WIDTH, perpAngle);
  }
};
