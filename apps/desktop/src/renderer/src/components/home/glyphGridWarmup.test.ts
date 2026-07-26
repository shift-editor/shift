import { describe, expect, it } from "vitest";
import { asGlyphId, type GlyphId } from "@shift/types";
import { nextWarmupChunk } from "./glyphGridWarmup";

const ids = Array.from({ length: 10 }, (_, index) => asGlyphId(`g${index}`));
const none = () => false;

describe("nextWarmupChunk", () => {
  it("radiates outward from the center, nearest first", () => {
    const chunk = nextWarmupChunk(ids, 4, none, 5);

    expect(chunk).toEqual([ids[4], ids[3], ids[5], ids[2], ids[6]]);
  });

  it("skips covered ids without wasting chunk slots", () => {
    const covered = new Set<GlyphId>([ids[4]!, ids[5]!]);
    const chunk = nextWarmupChunk(ids, 4, (glyphId) => covered.has(glyphId), 3);

    expect(chunk).toEqual([ids[3], ids[2], ids[6]]);
  });

  it("clamps an out-of-range center to the catalog bounds", () => {
    const chunk = nextWarmupChunk(ids, 99, none, 3);

    expect(chunk).toEqual([ids[9], ids[8], ids[7]]);
  });

  it("returns empty once everything reachable is covered", () => {
    expect(nextWarmupChunk(ids, 4, () => true, 5)).toEqual([]);
    expect(nextWarmupChunk([], 0, none, 5)).toEqual([]);
  });
});
