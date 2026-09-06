import { describe, expect, it } from "vitest";
import { sequenceDiff } from "./sequenceDiff";

describe("ordered sequence differences", () => {
  it("returns null for equal sequences", () => {
    expect(sequenceDiff(["a", "b"], ["a", "b"])).toBeNull();
  });

  it("retains only an appended item", () => {
    expect(sequenceDiff(["a"], ["a", "b"])).toEqual({
      start: 1,
      removed: [],
      inserted: ["b"],
    });
  });

  it("retains only a removed middle item", () => {
    expect(sequenceDiff(["a", "b", "c"], ["a", "c"])).toEqual({
      start: 1,
      removed: ["b"],
      inserted: [],
    });
  });

  it("preserves reordered contents as one reversible range", () => {
    expect(sequenceDiff(["a", "b", "c", "d"], ["a", "c", "b", "d"])).toEqual({
      start: 1,
      removed: ["b", "c"],
      inserted: ["c", "b"],
    });
  });
});
