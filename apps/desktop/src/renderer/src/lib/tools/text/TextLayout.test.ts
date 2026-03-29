import { describe, it, expect, vi } from "vitest";
import { layoutText, cursorXFromIndex, glyphBounds, layoutBounds, hitTestLayoutAt } from "./TextLayout";
import type { ToolContext } from "../core/ToolContext";
import type { FontMetrics } from "@shift/types";

function createMockEditor(advanceWidth = 500, xAdvance = 600): Partial<ToolContext> {
  return {
    getGlyphSvgPath: vi.fn(() => "M0 0 L100 0 L100 100 Z"),
    getGlyphAdvance: vi.fn(() => advanceWidth),
    getGlyph: vi.fn(() => ({ xAdvance }) as any),
    getFontMetrics: vi.fn(() => ({
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      capHeight: 700,
      xHeight: 500,
      lineGap: 0,
      italicAngle: 0,
      underlinePosition: -100,
      underlineThickness: 50,
    })),
  };
}

const metrics: FontMetrics = {
  unitsPerEm: 1000,
  ascender: 800,
  descender: -200,
  capHeight: 700,
  xHeight: 500,
  lineGap: 0,
  italicAngle: 0,
  underlinePosition: -100,
  underlineThickness: 50,
};

describe("TextLayout", () => {
  describe("layoutText", () => {
    it("should return empty layout for empty string", () => {
      const editor = createMockEditor();
      const layout = layoutText("", editor as ToolContext);
      expect(layout).toHaveLength(0);
    });

    it("should create layout with correct character count", () => {
      const editor = createMockEditor();
      const layout = layoutText("ABC", editor as ToolContext);
      expect(layout).toHaveLength(3);
    });

    it("should start offset at base glyph xAdvance", () => {
      const editor = createMockEditor(500, 600);
      const layout = layoutText("AB", editor as ToolContext);
      expect(layout[0].xOffset).toBe(600);
      expect(layout[1].xOffset).toBe(1100);
    });

    it("should store unicode values", () => {
      const editor = createMockEditor();
      const layout = layoutText("Hi", editor as ToolContext);
      expect(layout[0].unicode).toBe("H".codePointAt(0));
      expect(layout[1].unicode).toBe("i".codePointAt(0));
    });

    it("should store character strings", () => {
      const editor = createMockEditor();
      const layout = layoutText("AB", editor as ToolContext);
      expect(layout[0].char).toBe("A");
      expect(layout[1].char).toBe("B");
    });

    it("should query svg path for each character", () => {
      const editor = createMockEditor();
      layoutText("AB", editor as ToolContext);
      expect(editor.getGlyphSvgPath).toHaveBeenCalledTimes(2);
    });

    it("should use fallback advance when getGlyphAdvance returns null", () => {
      const editor = createMockEditor();
      (editor.getGlyphAdvance as any).mockReturnValue(null);
      const layout = layoutText("A", editor as ToolContext);
      expect(layout[0].advance).toBe(500);
    });

    it("should reuse glyph data from previous layout for same unicodes", () => {
      const editor = createMockEditor();
      const prev = layoutText("AB", editor as ToolContext);
      expect(editor.getGlyphSvgPath).toHaveBeenCalledTimes(2);

      (editor.getGlyphSvgPath as any).mockClear();
      (editor.getGlyphAdvance as any).mockClear();

      const next = layoutText("ABC", editor as ToolContext, prev);
      expect(editor.getGlyphSvgPath).toHaveBeenCalledTimes(1);
      expect(editor.getGlyphAdvance).toHaveBeenCalledTimes(1);
      expect(next[0].svgPath).toBe(prev[0].svgPath);
      expect(next[1].advance).toBe(prev[1].advance);
    });

    it("should not call bridge for repeated characters when previous layout provided", () => {
      const editor = createMockEditor();
      const prev = layoutText("A", editor as ToolContext);

      (editor.getGlyphSvgPath as any).mockClear();
      (editor.getGlyphAdvance as any).mockClear();

      layoutText("AA", editor as ToolContext, prev);
      expect(editor.getGlyphSvgPath).toHaveBeenCalledTimes(0);
    });
  });

  describe("glyphBounds", () => {
    it("should return correct bounds for a glyph", () => {
      const glyph = { unicode: 65, char: "A", svgPath: null, xOffset: 600, advance: 500 };
      const bounds = glyphBounds(glyph, metrics);
      expect(bounds).toEqual({
        x: 600, y: -200, width: 500, height: 1000,
        left: 600, top: -200, right: 1100, bottom: 800,
      });
    });
  });

  describe("layoutBounds", () => {
    it("should return null for empty layout", () => {
      expect(layoutBounds([], metrics)).toBeNull();
    });

    it("should return bounds spanning all glyphs", () => {
      const layout = [
        { unicode: 65, char: "A", svgPath: null, xOffset: 600, advance: 500 },
        { unicode: 66, char: "B", svgPath: null, xOffset: 1100, advance: 500 },
      ];
      const bounds = layoutBounds(layout, metrics);
      expect(bounds).toEqual({
        x: 600, y: -200, width: 1000, height: 1000,
        left: 600, top: -200, right: 1600, bottom: 800,
      });
    });
  });

  describe("hitTestLayoutAt", () => {
    const layout = [
      { unicode: 65, char: "A", svgPath: null, xOffset: 600, advance: 500 },
      { unicode: 66, char: "B", svgPath: null, xOffset: 1100, advance: 500 },
      { unicode: 67, char: "C", svgPath: null, xOffset: 1600, advance: 500 },
    ];

    it("should return 0 for point inside first glyph", () => {
      expect(hitTestLayoutAt(layout, metrics, { x: 700, y: 400 })).toBe(0);
    });

    it("should return 1 for point inside second glyph", () => {
      expect(hitTestLayoutAt(layout, metrics, { x: 1200, y: 400 })).toBe(1);
    });

    it("should return null for point outside y bounds", () => {
      expect(hitTestLayoutAt(layout, metrics, { x: 700, y: 1000 })).toBeNull();
    });

    it("should return null for point before first glyph", () => {
      expect(hitTestLayoutAt(layout, metrics, { x: 100, y: 400 })).toBeNull();
    });

    it("should return null for point after last glyph", () => {
      expect(hitTestLayoutAt(layout, metrics, { x: 5000, y: 400 })).toBeNull();
    });

    it("should return null for empty layout", () => {
      expect(hitTestLayoutAt([], metrics, { x: 100, y: 400 })).toBeNull();
    });
  });

  describe("cursorXFromIndex", () => {
    const layout = [
      { unicode: 65, char: "A", svgPath: null, xOffset: 600, advance: 500 },
      { unicode: 66, char: "B", svgPath: null, xOffset: 1100, advance: 500 },
    ];

    it("should return first glyph xOffset for index 0", () => {
      expect(cursorXFromIndex(layout, 0)).toBe(600);
    });

    it("should return glyph xOffset for index 1", () => {
      expect(cursorXFromIndex(layout, 1)).toBe(1100);
    });

    it("should return end position for index past length", () => {
      expect(cursorXFromIndex(layout, 2)).toBe(1600);
    });

    it("should return 0 for empty layout", () => {
      expect(cursorXFromIndex([], 0)).toBe(0);
    });
  });
});
