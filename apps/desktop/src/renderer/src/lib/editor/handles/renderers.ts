import { Vec2 } from "@shift/geo";
import { HANDLE_STYLES } from "@/lib/styles/style";
import type { IRenderer } from "@/types/graphics";
import type { HandleState } from "@/types/handle";

import {
  ARROW_SIZE,
  DIRECTION_INNER_SIZE_OFFSET,
  DIRECTION_RING_OFFSET,
  LAST_HANDLE_EDGE_OFFSET,
  LAST_HANDLE_LERP_SPACING,
} from "./constants";
import {
  drawArrowHead,
  drawDirectionArrow,
  drawFilledCircle,
  drawFilledRect,
  drawStrokedCircle,
  drawStrokedRect,
} from "./primitives";

export interface HandleOptions {
  isCounterClockWise?: boolean;
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

export const drawFirstHandle: HandleDrawFn = (ctx, x, y, state) => {
  const style = HANDLE_STYLES.first[state];
  ctx.setStyle(style);

  if (state === "selected") {
    drawFilledCircle(ctx, x, y, style.size);
  } else {
    drawStrokedCircle(ctx, x, y, style.size);
  }
};

export const drawCornerHandle: HandleDrawFn = (ctx, x, y, state) => {
  const style = HANDLE_STYLES.corner[state];
  ctx.setStyle(style);

  if (state === "selected") {
    drawFilledRect(ctx, x, y, style.size);
  } else {
    drawStrokedRect(ctx, x, y, style.size);
  }
};

export const drawControlHandle: HandleDrawFn = (ctx, x, y, state) => {
  const style = HANDLE_STYLES.control[state];
  ctx.setStyle(style);
  drawStrokedCircle(ctx, x, y, style.size);
  drawFilledCircle(ctx, x, y, style.size);
};

export const drawSmoothHandle: HandleDrawFn = (ctx, x, y, state) => {
  const style = HANDLE_STYLES.smooth[state];
  ctx.setStyle(style);
  drawStrokedCircle(ctx, x, y, style.size);
  drawFilledCircle(ctx, x, y, style.size);
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

  if (state === "selected") {
    drawFilledCircle(ctx, x, y, style.size - DIRECTION_INNER_SIZE_OFFSET);
  } else {
    drawStrokedCircle(ctx, x, y, style.size - DIRECTION_INNER_SIZE_OFFSET);
  }

  ctx.beginPath();
  const radius = style.size + DIRECTION_RING_OFFSET;
  ctx.arcTo(x, y, radius, 0, Math.PI, true);
  ctx.stroke();

  const arrowX = options?.isCounterClockWise ? x - radius : x + radius;
  drawDirectionArrow(ctx, arrowX, y, "up", ARROW_SIZE);
};

export const drawLastHandle: LastHandleDrawFn = (ctx, pos, state) => {
  const style = HANDLE_STYLES.last[state];
  ctx.setStyle(style);

  const p0 = { x: pos.x0, y: pos.y0 };
  const p1 = { x: pos.x1, y: pos.y1 };

  const theta = Vec2.angleTo(p0, p1);
  const arrowSize = style.size;

  const edgePoint = Vec2.lerp(p0, p1, LAST_HANDLE_EDGE_OFFSET);
  const distance = Vec2.dist(p0, edgePoint);
  const lerpFactor = LAST_HANDLE_LERP_SPACING / distance;

  for (const t of [0, lerpFactor]) {
    const { x, y } = Vec2.lerp(p0, p1, t);
    drawArrowHead(ctx, x, y, theta + Math.PI, arrowSize);
  }
};
