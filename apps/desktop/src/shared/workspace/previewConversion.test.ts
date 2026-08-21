import { describe, expect, it } from "vitest";
import { isConvertiblePreviewPath } from "./previewConversion";

describe("preview conversion capability", () => {
  it.each(["font.ufo", "/tmp/font.designspace", "C:\\Fonts\\Family.GLYPHS", "font.glyphspackage"])(
    "allows %s to become a Shift document",
    (sourcePath) => {
      expect(isConvertiblePreviewPath(sourcePath)).toBe(true);
    },
  );

  it.each(["font.ttf", "/tmp/fonts.with.dots/font.otf", ".ufo", "font.shift", "font.txt"])(
    "keeps %s outside preview conversion",
    (sourcePath) => {
      expect(isConvertiblePreviewPath(sourcePath)).toBe(false);
    },
  );
});
