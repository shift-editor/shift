import { describe, expect, it } from "vitest";
import { mintGlyphId, type GlyphPreview } from "@shift/types";
import { GlyphPreviewCache } from "./GlyphPreviewCache";

function preview(pathLength: number): GlyphPreview {
  return { glyphId: mintGlyphId(), svgPath: "M".repeat(pathLength), xAdvance: 500 };
}

describe("GlyphPreviewCache", () => {
  it("returns filled previews and bumps the version per fill", () => {
    const cache = new GlyphPreviewCache(10_000);
    const a = preview(10);

    expect(cache.version).toBe(0);
    cache.fill([a]);

    expect(cache.version).toBe(1);
    expect(cache.get(a.glyphId)).toEqual({ svgPath: a.svgPath, xAdvance: 500 });
  });

  it("empties on rekey and misses previews from the previous location", () => {
    const cache = new GlyphPreviewCache(10_000);
    const a = preview(10);
    cache.rekey("wght:400");
    cache.fill([a]);

    cache.rekey("wght:700");

    expect(cache.key).toBe("wght:700");
    expect(cache.size).toBe(0);
    expect(cache.get(a.glyphId)).toBeNull();
  });

  it("keeps the byte ledger within budget by evicting oldest entries", () => {
    const cache = new GlyphPreviewCache(800);
    const first = preview(200);
    const second = preview(200);
    cache.fill([first]);
    cache.fill([second]);

    expect(cache.get(first.glyphId)).toBeNull();
    expect(cache.get(second.glyphId)).not.toBeNull();
    expect(cache.bytes).toBeLessThanOrEqual(800);
  });

  it("treats reads as recency so touched entries survive eviction", () => {
    const cache = new GlyphPreviewCache(1_100);
    const a = preview(200);
    const b = preview(200);
    cache.fill([a, b]);

    cache.get(a.glyphId);
    cache.fill([preview(200)]);

    expect(cache.get(a.glyphId)).not.toBeNull();
    expect(cache.get(b.glyphId)).toBeNull();
  });

  it("reports nearing the budget so warm-up can stop instead of churning", () => {
    const cache = new GlyphPreviewCache(1_000);
    expect(cache.nearBudget()).toBe(false);

    cache.fill([preview(420)]);

    expect(cache.nearBudget()).toBe(true);
  });
});
