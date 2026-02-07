/**
 * Global test setup — provides browser API polyfills for Node.js test environment.
 */

// Path2D is a browser API used by GlyphRenderCache and Canvas2DRenderer.
// Provide a minimal stub for tests.
if (typeof globalThis.Path2D === "undefined") {
  globalThis.Path2D = class Path2D {
    constructor(_path?: string | Path2D) {
      // no-op stub
    }
  } as any;
}
