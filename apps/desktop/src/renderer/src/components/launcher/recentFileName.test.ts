import { describe, expect, it } from "vitest";
import { filenameWrapChunks, middleTruncatedName } from "./recentFileName";

describe("recent file names", () => {
  it("wraps before the extension and after hyphens and underscores", () => {
    expect(filenameWrapChunks("ScienceGothic_Condensed-Bold.ttf")).toEqual([
      "ScienceGothic_",
      "Condensed-",
      "Bold",
      ".ttf",
    ]);
  });

  it("cuts the middle of a name but keeps the end of the stem and the extension", () => {
    expect(middleTruncatedName("OpenSans-CondensedItalic.shift", 9)).toBe("OpenSans-…alic.shift");
  });

  it("leaves a name whole when the kept head already reaches the tail", () => {
    expect(middleTruncatedName("Ag.otf", 10)).toBe("Ag.otf");
  });
});
