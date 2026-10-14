import { describe, expect, it } from "vitest";
import { classMembers, glyphRange } from "./classHover";

// The hover passes the end of the class's definition name, as Feanor reports it.
const members = (text: string, name: string) =>
  classMembers(text, text.indexOf(`${name} =`) + name.length, new Set([name]));

describe("a class's glyphs, for its hover", () => {
  it("lists the names a definition writes, without escapes", () => {
    expect(members("@lc = [a \\b  c];", "@lc")).toEqual(["a", "b", "c"]);
  });

  it("expands a nested class once, even when classes refer to each other", () => {
    const text = "@vowels = [a e @lc];\n@lc = [x @vowels y];";
    expect(members(text, "@lc")).toEqual(["x", "a", "e", "y"]);
  });

  it("expands ranges, spaced or not, but keeps hyphenated glyph names", () => {
    const isGlyph = (name: string) => name === "beh-ar";
    const text = "@set = [A - C a.sc-c.sc beh-ar one.8 - one.10];";
    expect(classMembers(text, 4, new Set(["@set"]), isGlyph)).toEqual([
      "A",
      "B",
      "C",
      "a.sc",
      "b.sc",
      "c.sc",
      "beh-ar",
      "one.8",
      "one.10",
    ]);
  });

  it("counts through numbered names keeping their width", () => {
    expect(glyphRange("cid00098", "cid00101")).toEqual([
      "cid00098",
      "cid00099",
      "cid00100",
      "cid00101",
    ]);
  });
});
