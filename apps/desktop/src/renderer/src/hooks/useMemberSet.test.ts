import { describe, expect, it } from "vitest";
import { withMembership } from "./useMemberSet";

describe("withMembership", () => {
  const set: ReadonlySet<string> = new Set(["a", "b"]);

  it("adds and removes members without changing the original", () => {
    expect([...withMembership(set, ["c"], true)]).toEqual(["a", "b", "c"]);
    expect([...withMembership(set, ["a", "z"], false)]).toEqual(["b"]);
    expect([...set]).toEqual(["a", "b"]);
  });

  it("returns the same set when nothing changes, so state stays put", () => {
    expect(withMembership(set, ["a"], true)).toBe(set);
    expect(withMembership(set, ["z"], false)).toBe(set);
    expect(withMembership(set, [], true)).toBe(set);
  });
});
