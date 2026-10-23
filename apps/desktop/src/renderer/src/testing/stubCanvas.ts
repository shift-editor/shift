/**
 * Minimal CanvasRenderingContext2D + Canvas stub for perf benchmarks.
 *
 * All draw operations are no-ops — benchmarks measure computation cost,
 * not pixel output. The setup.ts Path2D stub handles path construction.
 */

import { Mat } from "@shift/geo";
import { Canvas } from "@shift/editor/testing";
import type { CameraTransform } from "@shift/editor/testing";
import { spaceTransform } from "@shift/editor/spaces";
import type { TestEditor } from "./TestEditor";

const noop = () => {};

const DEFAULT_CAMERA: CameraTransform = {
  view: spaceTransform<"scene", "screen">(Mat.Identity()),
  zoom: 1,
  logicalWidth: 1000,
  logicalHeight: 800,
};

function createStubContext(): CanvasRenderingContext2D {
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

export function createStubCanvas(camera: CameraTransform = DEFAULT_CAMERA): Canvas {
  return new Canvas(createStubContext(), camera);
}

/** Contexts to draw a layer into instead of a no-op stub. */
export interface StubSurfaceContexts {
  readonly background?: CanvasRenderingContext2D;
  readonly scene?: CanvasRenderingContext2D;
}

/**
 * Attaches the real renderer to 1000 × 800 stub canvases at 1×, so its layers
 * draw into `contexts` (or no-op stubs) on each animation frame.
 */
export function attachStubSurfaces(editor: TestEditor, contexts: StubSurfaceContexts = {}): void {
  const rect = { x: 0, y: 0, width: 1000, height: 800, left: 0, top: 0, right: 1000, bottom: 800 };
  const element = () =>
    ({
      width: 1000,
      height: 800,
      getBoundingClientRect: () => rect,
      getContext: () => null,
      addEventListener: noop,
      removeEventListener: noop,
    }) as unknown as HTMLCanvasElement;
  const surface = (ctx: CanvasRenderingContext2D = createStubContext()) => ({
    canvas: element(),
    rect,
    dpr: 1,
    ctx,
    width: 1000,
    height: 800,
  });

  editor.attachRenderSurfaces(
    surface(contexts.background) as never,
    surface(contexts.scene) as never,
    surface() as never,
    { canvas: element(), rect, dpr: 1, width: 1000, height: 800 } as never,
  );
}
