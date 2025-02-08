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
 */
export const scaleCanvasDPR = (canvas: HTMLCanvasElement) => {
  const rect = canvas.getBoundingClientRect();
  const { width, height } = dprWH(rect.width, rect.height);

  canvas.width = width;
  canvas.height = height;
};

export const getMouseCoords = (
  clientX: number,
  clientY: number,
  rect: DOMRect,
) => {
  const x = Math.round(clientX - rect.left);
  const y = Math.round(clientY - rect.top);

  return { x, y };
};
