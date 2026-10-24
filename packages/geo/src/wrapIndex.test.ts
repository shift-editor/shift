import { describe, expect, it } from "vitest";
import { cyclicAt, wrapIndex } from "./wrapIndex";

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

describe("cyclicAt", () => {
  const items = ["a", "b", "c"];

  it("wraps past either end when wrapping", () => {
    expect(cyclicAt(items, 3, true)).toBe("a");
    expect(cyclicAt(items, -1, true)).toBe("c");
    expect(cyclicAt(items, 7, true)).toBe("b");
  });

  it("returns null past either end when not wrapping", () => {
    expect(cyclicAt(items, 1, false)).toBe("b");
    expect(cyclicAt(items, 3, false)).toBeNull();
    expect(cyclicAt(items, -1, false)).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(cyclicAt([], 0, true)).toBeNull();
  });
});
