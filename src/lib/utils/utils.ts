import { IGraphicContext } from "../../types/graphics";

// canvas
/**
 * Returns the width and height of the canvas, taking into account the device pixel ratio.
 * @param w - The width of the canvas.
 * @param h - The height of the canvas.
 * @returns The width and height of the canvas, taking into account the device pixel ratio.
 */
export const dprWH = (w: number, h: number) => {
  const dpr = window.devicePixelRatio || 1;
  return {
    dpr,
    width: w * dpr,
    height: h * dpr,
  };
};

/**
 * Scales the canvas to the device pixel ratio.
 * @param canvas - The canvas to scale.
 * @param ctx - The graphics context.
 */
export const scaleCanvasDPR = (
  canvas: HTMLCanvasElement,
  ctx: IGraphicContext,
) => {
  const rect = canvas.getBoundingClientRect();
  const { width, height, dpr } = dprWH(rect.width, rect.height);

  canvas.width = width;
  canvas.height = height;

  ctx.recreateSurface(canvas);

  const renderer = ctx.getContext();
  renderer.scale(dpr, dpr);
};
