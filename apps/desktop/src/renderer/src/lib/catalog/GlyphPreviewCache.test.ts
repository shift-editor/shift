import { describe, expect, it } from "vitest";
import { mintGlyphId, type GlyphPreview } from "@shift/types";
import { GlyphPreviewCache } from "./GlyphPreviewCache";

function preview(pathLength: number): GlyphPreview {
  return { glyphId: mintGlyphId(), svgPath: "M".repeat(pathLength), xAdvance: 500 };
}

describe("SVG preview residency", () => {
  it("publishes drawable and shapeless glyphs as one complete request", () => {
    const cache = new GlyphPreviewCache(10_000);
    const drawable = preview(10);
    const shapelessId = mintGlyphId();

    cache.fill([drawable.glyphId, shapelessId], [drawable]);

    expect(cache.get(drawable.glyphId)).toEqual({ svgPath: drawable.svgPath, xAdvance: 500 });
    expect(cache.has(shapelessId)).toBe(true);
    expect(cache.get(shapelessId)).toBeNull();
  });

  it("drops previews from the previous design location", () => {
    const cache = new GlyphPreviewCache(10_000);
    const glyph = preview(10);
    cache.rekey("400");
    cache.fill([glyph.glyphId], [glyph]);

    cache.rekey("700");

    expect(cache.key).toBe("700");
    expect(cache.has(glyph.glyphId)).toBe(false);
  });

  it("keeps the byte ledger bounded by evicting least-recent entries", () => {
    const cache = new GlyphPreviewCache(800);
    const first = preview(200);
    const second = preview(200);
    cache.fill([first.glyphId], [first]);
    cache.fill([second.glyphId], [second]);

    expect(cache.has(first.glyphId)).toBe(false);
    expect(cache.has(second.glyphId)).toBe(true);
    expect(cache.bytes).toBeLessThanOrEqual(800);
  });

  it("removes only invalidated glyphs", () => {
    const cache = new GlyphPreviewCache(10_000);
    const first = preview(10);
    const second = preview(10);
    cache.fill([first.glyphId, second.glyphId], [first, second]);

    cache.invalidate([first.glyphId]);

    expect(cache.has(first.glyphId)).toBe(false);
    expect(cache.has(second.glyphId)).toBe(true);
  });
});
