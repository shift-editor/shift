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
