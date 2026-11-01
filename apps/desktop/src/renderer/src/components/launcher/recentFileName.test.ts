import { describe, expect, it } from "vitest";
import { filenameParts, longestFittingName, middleTruncatedName } from "./recentFileName";

describe("recent file names", () => {
  it("splits a name before its extension", () => {
    expect(filenameParts("MutatorSans.designspace")).toEqual({
      stem: "MutatorSans",
      extension: ".designspace",
    });
    expect(filenameParts("Glyphs Package")).toEqual({ stem: "Glyphs Package", extension: "" });
    expect(filenameParts(".hidden")).toEqual({ stem: ".hidden", extension: "" });
  });

  it("cuts the middle of a name but keeps the end of the stem and the extension", () => {
    expect(middleTruncatedName("OpenSans-CondensedItalic.shift", 9)).toBe("OpenSans-…alic.shift");
  });

  it("leaves a name whole when the kept head already reaches the tail", () => {
    expect(middleTruncatedName("Ag.otf", 10)).toBe("Ag.otf");
  });

  it("keeps the longest head that fits", () => {
    const fitsIn = (characters: number) => (label: string) => label.length <= characters;

    expect(longestFittingName("OpenSans-CondensedItalic.shift", fitsIn(40))).toBe(
      "OpenSans-CondensedItalic.shift",
    );
    expect(longestFittingName("OpenSans-CondensedItalic.shift", fitsIn(20))).toBe(
      "OpenSans-…alic.shift",
    );
  });
});
