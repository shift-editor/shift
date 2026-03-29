/**
 * Global test setup — provides browser API polyfills for Node.js test environment.
 */

// Path2D is a browser API used by GlyphRenderCache and Canvas2DRenderer.
// Provide a minimal stub for tests.
if (typeof globalThis.Path2D === "undefined") {
  const Path2DStub = class Path2D {
    constructor(_path?: string | Path2D) {
      // no-op stub
    }

    moveTo(_x: number, _y: number) {}
    lineTo(_x: number, _y: number) {}
    quadraticCurveTo(_cpx: number, _cpy: number, _x: number, _y: number) {}
    bezierCurveTo(
      _cp1x: number,
      _cp1y: number,
      _cp2x: number,
      _cp2y: number,
      _x: number,
      _y: number,
    ) {}
    closePath() {}
    addPath(_path: Path2D) {}
  };
  globalThis.Path2D = Path2DStub as unknown as typeof Path2D;
}
