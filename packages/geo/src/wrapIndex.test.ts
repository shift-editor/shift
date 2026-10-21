import { describe, expect, it } from "vitest";
import { wrapIndex } from "./wrapIndex";

describe("wrapIndex", () => {
  it("leaves an index inside the cycle unchanged", () => {
    expect(wrapIndex(2, 4)).toBe(2);
  });

  it("wraps past-the-end and negative indices into the cycle", () => {
    expect(wrapIndex(4, 4)).toBe(0);
    expect(wrapIndex(9, 4)).toBe(1);
    expect(wrapIndex(-1, 4)).toBe(3);
    expect(wrapIndex(-5, 4)).toBe(3);
  });
});
