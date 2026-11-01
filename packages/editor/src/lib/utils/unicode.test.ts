import { describe, expect, it } from "vitest";
import { parseCodepoint } from "./unicode";

describe("parseCodepoint", () => {
  it("reads hex with or without a prefix", () => {
    expect(parseCodepoint("0041")).toBe(0x41);
    expect(parseCodepoint("U+00c5")).toBe(0xc5);
    expect(parseCodepoint(" u+1F600 ")).toBe(0x1f600);
    expect(parseCodepoint("0x10FFFF")).toBe(0x10ffff);
  });

  it("rejects text that is not a Unicode scalar value", () => {
    expect(parseCodepoint("")).toBeNull();
    expect(parseCodepoint("U+")).toBeNull();
    expect(parseCodepoint("A?")).toBeNull();
    expect(parseCodepoint("110000")).toBeNull();
    expect(parseCodepoint("D800")).toBeNull();
  });
});
