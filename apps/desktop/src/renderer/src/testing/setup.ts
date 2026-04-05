/**
 * Global test setup — provides browser API polyfills for Node.js test environment.
 */

// window + requestAnimationFrame — used by FrameHandler for render scheduling.
if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = globalThis;
}
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number;
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);
}

// Path2D is a browser API used by GlyphRenderCache and Canvas2DRenderer.
// Provide a minimal stub for tests.
if (typeof globalThis.Path2D === "undefined") {
  const Path2DStub = class Path2D {
    readonly commands: Array<
      | { type: "constructor"; path?: string | Path2D }
      | { type: "moveTo"; x: number; y: number }
      | { type: "lineTo"; x: number; y: number }
      | { type: "quadraticCurveTo"; cpx: number; cpy: number; x: number; y: number }
      | {
          type: "bezierCurveTo";
          cpx1: number;
          cpy1: number;
          cpx2: number;
          cpy2: number;
          x: number;
          y: number;
        }
      | { type: "closePath" }
      | { type: "addPath"; path: Path2D }
    > = [];

    constructor(_path?: string | Path2D) {
      if (_path === undefined) {
        this.commands.push({ type: "constructor" });
        return;
      }

      this.commands.push({ type: "constructor", path: _path });
    }

    moveTo(x: number, y: number): void {
      this.commands.push({ type: "moveTo", x, y });
    }

    lineTo(x: number, y: number): void {
      this.commands.push({ type: "lineTo", x, y });
    }

    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
      this.commands.push({ type: "quadraticCurveTo", cpx, cpy, x, y });
    }

    bezierCurveTo(cpx1: number, cpy1: number, cpx2: number, cpy2: number, x: number, y: number) {
      this.commands.push({ type: "bezierCurveTo", cpx1, cpy1, cpx2, cpy2, x, y });
    }

    closePath(): void {
      this.commands.push({ type: "closePath" });
    }

    addPath(path: Path2D): void {
      this.commands.push({ type: "addPath", path });
    }
  };
  globalThis.Path2D = Path2DStub as unknown as typeof Path2D;
}
