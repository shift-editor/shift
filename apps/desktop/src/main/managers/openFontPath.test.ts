import { describe, expect, it } from "vitest";
import path from "node:path";
import { extractFirstFontPath, isSupportedFontPath, normalizeFontPath } from "./openFontPath";

describe("openFontPath", () => {
  describe("isSupportedFontPath", () => {
    it("accepts supported font extensions", () => {
      expect(isSupportedFontPath("/tmp/font.ufo")).toBe(true);
      expect(isSupportedFontPath("/tmp/font.ttf")).toBe(true);
      expect(isSupportedFontPath("/tmp/font.otf")).toBe(true);
      expect(isSupportedFontPath("/tmp/font.OTF")).toBe(true);
    });

    it("rejects unsupported extensions", () => {
      expect(isSupportedFontPath("/tmp/font.txt")).toBe(false);
      expect(isSupportedFontPath("/tmp/font")).toBe(false);
    });
  });

  describe("normalizeFontPath", () => {
    it("returns normalized path for supported files", () => {
      const source = `  ${path.join("tmp", "a", "..", "font.ufo")}  `;
      expect(normalizeFontPath(source)).toBe(path.normalize(path.join("tmp", "font.ufo")));
    });

    it("returns null for unsupported files", () => {
      expect(normalizeFontPath("font.txt")).toBeNull();
      expect(normalizeFontPath("")).toBeNull();
    });
  });

  describe("extractFirstFontPath", () => {
    it("returns the first valid font path from argv", () => {
      const first = path.join("tmp", "A.otf");
      const second = path.join("tmp", "B.ttf");
      const argv = ["electron", ".", "--inspect", first, second];
      expect(extractFirstFontPath(argv)).toBe(path.normalize(first));
    });

    it("returns null when argv contains no supported font paths", () => {
      const argv = ["electron", ".", "--inspect", "--foo=bar", "/tmp/readme.md"];
      expect(extractFirstFontPath(argv)).toBeNull();
    });
  });
});
