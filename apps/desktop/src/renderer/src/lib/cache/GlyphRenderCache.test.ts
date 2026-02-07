import { describe, it, expect, beforeEach } from "vitest";
import { GlyphRenderCache } from "./GlyphRenderCache";

describe("GlyphRenderCache", () => {
  beforeEach(() => {
    GlyphRenderCache.clear();
  });

  it("should create and cache a Path2D from SVG string", () => {
    const path = GlyphRenderCache.get(65, "M0 0L100 100");
    expect(path).toBeInstanceOf(Path2D);
    expect(GlyphRenderCache.size).toBe(1);
  });

  it("should return the same Path2D on subsequent calls", () => {
    const first = GlyphRenderCache.get(65, "M0 0L100 100");
    const second = GlyphRenderCache.get(65, "M0 0L100 100");
    expect(first).toBe(second);
  });

  it("should cache different unicodes separately", () => {
    const pathA = GlyphRenderCache.get(65, "M0 0L100 100");
    const pathB = GlyphRenderCache.get(66, "M0 0L200 200");
    expect(pathA).not.toBe(pathB);
    expect(GlyphRenderCache.size).toBe(2);
  });

  it("should delete a specific entry", () => {
    GlyphRenderCache.get(65, "M0 0L100 100");
    expect(GlyphRenderCache.size).toBe(1);
    GlyphRenderCache.delete(65);
    expect(GlyphRenderCache.size).toBe(0);
  });

  it("should clear all entries", () => {
    GlyphRenderCache.get(65, "M0 0L100 100");
    GlyphRenderCache.get(66, "M0 0L200 200");
    expect(GlyphRenderCache.size).toBe(2);
    GlyphRenderCache.clear();
    expect(GlyphRenderCache.size).toBe(0);
  });

  it("should create a new Path2D after deletion", () => {
    const first = GlyphRenderCache.get(65, "M0 0L100 100");
    GlyphRenderCache.delete(65);
    const second = GlyphRenderCache.get(65, "M0 0L100 100");
    expect(first).not.toBe(second);
  });
});
