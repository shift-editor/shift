/**
 * Minimal CanvasRenderingContext2D stub for render surfaces in tests and perf benchmarks.
 *
 * All draw operations are no-ops — benchmarks measure computation cost,
 * not pixel output. The setup.ts Path2D stub handles path construction.
 */

const noop = () => {};

export function createStubContext(): CanvasRenderingContext2D {
  return {
    canvas: { width: 1000, height: 800 },
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    rect: noop,
    stroke: noop,
    fill: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    setLineDash: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    transform: noop,
    setTransform: noop,
    resetTransform: noop,
    measureText: () => ({ width: 0 }),
    fillText: noop,
    strokeText: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    drawImage: noop,
    getImageData: () => ({
      data: new Uint8ClampedArray(0),
      width: 0,
      height: 0,
    }),
    putImageData: noop,
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    globalAlpha: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
}

/** One straight line a recorded context stroked, in canvas pixels, with the style it was stroked in. */
export interface StrokedLine {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  readonly style: string;
}

/**
 * Makes `ctx` record the straight lines it strokes, one list per frame.
 *
 * @remarks
 * Tracks the context's transform through `save`, `restore`, `transform`,
 * `setTransform` and `resetTransform`, so each line is kept in canvas pixels
 * whatever units it was drawn in. A frame starts at each `clearRect`, as the
 * renderer clears a layer before drawing it.
 *
 * @param frames - Receives a new list per frame; the last is the latest frame.
 */
export function recordStrokedLines(ctx: CanvasRenderingContext2D, frames: StrokedLine[][]): void {
  type Matrix = readonly [number, number, number, number, number, number];
  const identity: Matrix = [1, 0, 0, 1, 0, 0];
  let matrix: Matrix = identity;
  const saved: Matrix[] = [];
  let path: { from: { x: number; y: number }; to: { x: number; y: number } }[] = [];
  let cursor: { x: number; y: number } | null = null;

  const multiply = ([a, b, c, d, e, f]: Matrix, [g, h, i, j, k, l]: Matrix): Matrix => [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ];
  const project = (x: number, y: number) => {
    const [a, b, c, d, e, f] = matrix;
    return { x: a * x + c * y + e, y: b * x + d * y + f };
  };

  Object.assign(ctx, {
    save: () => saved.push(matrix),
    restore: () => {
      matrix = saved.pop() ?? identity;
    },
    transform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      matrix = multiply(matrix, [a, b, c, d, e, f]);
    },
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      matrix = [a, b, c, d, e, f];
    },
    resetTransform: () => {
      matrix = identity;
    },
    clearRect: () => frames.push([]),
    beginPath: () => {
      path = [];
      cursor = null;
    },
    moveTo: (x: number, y: number) => {
      cursor = project(x, y);
    },
    lineTo: (x: number, y: number) => {
      const to = project(x, y);
      if (cursor) path.push({ from: cursor, to });
      cursor = to;
    },
    stroke: (stroked?: Path2D) => {
      if (stroked) return;
      const style = String(ctx.strokeStyle);
      frames.at(-1)?.push(...path.map((line) => ({ ...line, style })));
    },
  });
}
