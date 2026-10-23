import { signalDebug } from "../lib/signals";

// Lists every signal, so `signalDebug.dumpByName` can find hidden readers while debugging a test.
signalDebug.registerNodes();

if (typeof globalThis.window === "undefined") {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}

if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
    setTimeout(callback, 0) as unknown as number;
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

if (typeof globalThis.Path2D === "undefined") {
  globalThis.Path2D = class {
    moveTo(): void {}
    lineTo(): void {}
    quadraticCurveTo(): void {}
    bezierCurveTo(): void {}
    closePath(): void {}
    addPath(): void {}
  } as unknown as typeof Path2D;
}
