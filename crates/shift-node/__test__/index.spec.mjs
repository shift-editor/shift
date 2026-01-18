import { describe, it, expect } from "vitest";
import { createRequire } from "module";

// Need to use createRequire for CommonJS modules in ESM context
const require = createRequire(import.meta.url);
const { FontEngine } = require("../index.js");

describe("FontEngine", () => {
  it("FontEngine creation", () => {
    const engine = new FontEngine();
    expect(engine).toBeTruthy();
    expect(typeof engine.getMetadata).toBe("function");
    expect(typeof engine.getMetrics).toBe("function");
    expect(typeof engine.getGlyphCount).toBe("function");
  });

  it("FontEngine default values", () => {
    const engine = new FontEngine();
    const metadata = engine.getMetadata();
    const metrics = engine.getMetrics();

    expect(metadata.family).toBe("Untitled Font");
    expect(metadata.styleName).toBe("Regular");
    expect(metadata.version).toBe(1);
    expect(metrics.unitsPerEm).toBe(1000);
    expect(metrics.ascender).toBe(750);
    expect(metrics.descender).toBe(-200);
    expect(metrics.capHeight).toBe(700);
    expect(metrics.xHeight).toBe(500);
    expect(engine.getGlyphCount()).toBe(0);
  });
});
