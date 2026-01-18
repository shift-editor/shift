import type { IRenderer } from '@/types/graphics';
import type { HandleState, HandleType } from '@/types/handle';

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
} from './renderers';

export type { HandleOptions, LastHandlePosition } from './renderers';
export * from './constants';

const handleDrawers: Record<Exclude<HandleType, 'last'>, HandleDrawFn> = {
  corner: drawCornerHandle,
  control: drawControlHandle,
  smooth: drawSmoothHandle,
  first: drawFirstHandle,
  direction: drawDirectionHandle,
};

export function drawHandle(
  ctx: IRenderer,
  type: Exclude<HandleType, 'last'>,
  x: number,
  y: number,
  state: HandleState,
  options?: HandleOptions
): void {
  handleDrawers[type](ctx, x, y, state, options);
}

export function drawHandleLast(
  ctx: IRenderer,
  pos: LastHandlePosition,
  state: HandleState
): void {
  drawLastHandle(ctx, pos, state);
}
