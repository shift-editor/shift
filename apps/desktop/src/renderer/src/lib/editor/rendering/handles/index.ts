import type { IRenderer } from "@/types/graphics";

import {
  drawControlHandle,
  drawCornerHandle,
  drawDirectionHandle,
  drawFirstHandle,
  drawLastHandle,
  drawSmoothHandle,
  type HandleDrawFn,
  type HandleOptions,
  type LastHandlePosition,
  type HandleState,
  type HandleType,
} from "./renderers";

export type { HandleOptions, LastHandlePosition, HandleState, HandleType } from "./renderers";
export * from "./constants";
export { drawBoundingBoxHandles, type BoundingBoxHandlesOptions } from "./boundingBoxHandles";

const handleDrawers: Record<Exclude<HandleType, "last">, HandleDrawFn> = {
  corner: drawCornerHandle,
  control: drawControlHandle,
  smooth: drawSmoothHandle,
  first: drawFirstHandle,
  direction: drawDirectionHandle,
};

export function drawHandle(
  ctx: IRenderer,
  type: Exclude<HandleType, "last">,
  x: number,
  y: number,
  state: HandleState,
  options?: HandleOptions,
): void {
  handleDrawers[type](ctx, x, y, state, options);
}

export function drawHandleLast(ctx: IRenderer, pos: LastHandlePosition, state: HandleState): void {
  drawLastHandle(ctx, pos, state);
}
