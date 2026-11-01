import { describe, expect, it } from "vitest";
import { IndexKey } from "./indexKey";

describe("IndexKey", () => {
  it("makes a key between any two neighbours, and before the first and after the last", () => {
    const middle = IndexKey.between(null, null);
    const last = IndexKey.between(middle, null);
    const first = IndexKey.between(null, middle);
    const between = IndexKey.between(middle, last);
    const keys = [last, between, first, middle];

    expect(keys.sort(IndexKey.compare)).toEqual([first, middle, between, last]);
  });

  it("refuses keys that are equal or out of order", () => {
    const first = IndexKey.between(null, null);
    const second = IndexKey.between(first, null);

    expect(() => IndexKey.between(second, first)).toThrow();
    expect(() => IndexKey.between(first, first)).toThrow();
  });
});
