import { describe, expect, it } from "vitest";
import { IndexKey } from "./indexKey";

describe("IndexKey", () => {
  it("keeps the order sibling keys have always sorted in", () => {
    // The keys scenes have written so far, `a` and the sibling count, in the order the
    // scene sorted them: as plain strings, so `a10` before `a2`.
    const existing = Array.from({ length: 12 }, (_, count) => `a${count}`);
    const sorted = ["a0", "a1", "a10", "a11", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"];

    expect([...existing].sort(IndexKey.compare)).toEqual(sorted);
  });

  it("makes a key between any two neighbours, and after the last", () => {
    const first = IndexKey.between(null, null);
    const last = IndexKey.between(first, null);
    const middle = IndexKey.between(first, last);
    const keys = [last, middle, first];

    expect(keys.sort(IndexKey.compare)).toEqual([first, middle, last]);
  });
});
