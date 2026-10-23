import { createStubCanvas } from "@/testing/stubCanvas";

/**
 * Shared setup for benches that redraw a real editor into stub canvases.
 *
 * @remarks
 * Importing this replaces `requestAnimationFrame` with a queue that
 * {@link flushFrames} runs by hand, so a bench's redraw happens inside its
 * timed function.
 */

// Hand-run animation frames: render effects schedule here and run in `flushFrames`.
let frameQueue: Array<() => void> = [];
let nextFrameId = 0;
globalThis.requestAnimationFrame = ((callback: () => void) => {
  frameQueue.push(callback);
  return ++nextFrameId;
}) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = () => {};

/** Runs queued frames, and frames they queue, like the browser would before painting. */
export function flushFrames(): number {
  let ran = 0;
  for (let guard = 0; frameQueue.length > 0 && guard < 10; guard++) {
    const queue = frameQueue;
    frameQueue = [];
    for (const callback of queue) {
      ran++;
      callback();
    }
  }
  return ran;
}

export function stubSurfaces() {
  const rect = { x: 0, y: 0, width: 1000, height: 800, left: 0, top: 0, right: 1000, bottom: 800 };
  const element = () =>
    ({
      width: 1000,
      height: 800,
      getBoundingClientRect: () => rect,
      getContext: () => null,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as HTMLCanvasElement;
  const surface = () => ({
    canvas: element(),
    rect,
    dpr: 1,
    ctx: createStubCanvas().ctx,
    width: 1000,
    height: 800,
  });
  return {
    background: surface(),
    scene: surface(),
    overlay: surface(),
    markers: { canvas: element(), rect, dpr: 1, width: 1000, height: 800 },
  };
}
