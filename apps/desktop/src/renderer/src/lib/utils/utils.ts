export const isDev = process.env.NODE_ENV === "development";

/**
 * Returns the remainder of a number divided by a divisor, ensuring the result is positive.
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Remainder
 * To obtain a modulo in JavaScript, in place of n % d, use ((n % d) + d) % d.
 */
export const mod = (n: number, d: number) => {
  return ((n % d) + d) % d;
};

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

export const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};
