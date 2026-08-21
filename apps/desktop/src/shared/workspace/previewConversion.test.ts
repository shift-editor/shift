import { describe, expect, it } from "vitest";
import { isConvertiblePreviewPath } from "./previewConversion";

describe("preview conversion capability", () => {
  it.each(["font.ufo", "font.designspace", "font.glyphs", "font.glyphspackage"])(
    "allows %s to become a Shift document",
    (sourcePath) => {
      expect(isConvertiblePreviewPath(sourcePath)).toBe(true);
    },
  );

  it.each(["font.ttf", "font.otf", "font.shift", "font.txt"])(
    "keeps %s outside preview conversion",
    (sourcePath) => {
      expect(isConvertiblePreviewPath(sourcePath)).toBe(false);
    },
  );
});
