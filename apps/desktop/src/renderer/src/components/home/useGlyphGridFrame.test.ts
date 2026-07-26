import { beforeEach, describe, expect, it } from "vitest";
import { mintGlyphId } from "@shift/types";
import type { Glyph } from "@/lib/model/Glyph";
import { TestEditor } from "@/testing/TestEditor";
import { createGlyphGridFrameCell } from "./useGlyphGridFrame";

describe("Glyph Grid frame preparation", () => {
  let editor: TestEditor;
  let glyph: Glyph;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    glyph = editor.glyphForId(editor.glyphRecord!.id)!;
  });

  it("keeps a complete preview current with authored changes", async () => {
    const frameCell = createGlyphGridFrameCell([glyph], new Map(), editor.designLocationCell);
    expect(frameCell.peek().previews.has(glyph.id)).toBe(true);

    editor.requireGlyphLayer().setXAdvance(700);
    await editor.settle();

    expect(frameCell.peek().previews.get(glyph.id)).toEqual({ svgPath: "", xAdvance: 700 });
  });

  it("publishes previews for exactly the supplied resident glyphs", () => {
    const frameCell = createGlyphGridFrameCell([glyph], new Map(), editor.designLocationCell);

    const previews = frameCell.peek().previews;
    expect(previews.size).toBe(1);
    expect(previews.has(glyph.id)).toBe(true);
  });

  it("masks missing models with fallback previews without overriding live ones", () => {
    const fallbackId = mintGlyphId();
    const fallback = new Map([
      [fallbackId, { svgPath: "M0 0", xAdvance: 300 }],
      [glyph.id, { svgPath: "M9 9", xAdvance: 999 }],
    ]);
    const frameCell = createGlyphGridFrameCell([glyph], fallback, editor.designLocationCell);

    const previews = frameCell.peek().previews;
    expect(previews.get(fallbackId)).toEqual({ svgPath: "M0 0", xAdvance: 300 });
    expect(previews.get(glyph.id)).not.toEqual({ svgPath: "M9 9", xAdvance: 999 });
  });
});
