import { describe, expect, it } from "vitest";
import type { GlyphId, SlugAtlas, SlugSection, SourceId } from "@shift/types";
import {
  captureSlugAtlasSections,
  createSlugAtlasSections,
  createSlugFrame,
  createSlugGlyphMap,
} from "./SlugAtlas";

const emptySection = (): SlugSection => ({ offset: 0, length: 0 });

function residentFixture(): { atlas: SlugAtlas; bytes: Uint8Array<ArrayBuffer> } {
  const glyphs = { offset: 256, length: 64 };
  const componentGlyphs = { offset: 512, length: 24 };
  const atlas: SlugAtlas = {
    generation: 7,
    bandCount: 8,
    weightCount: 1,
    layout: {
      baseCurves: emptySection(),
      curveDeltas: emptySection(),
      sparseDeltas: emptySection(),
      glyphs,
      sources: emptySection(),
      sourceAdvances: emptySection(),
      componentGlyphs,
      componentParts: emptySection(),
      components: emptySection(),
      componentSources: emptySection(),
      anchorSources: emptySection(),
      lineBits: emptySection(),
      totalLength: 536,
    },
    glyphs: [
      {
        glyphId: "glyph-a" as GlyphId,
        defaultGlyph: 0,
        exactSources: [{ sourceId: "source-heavy" as SourceId, glyphIndex: 1 }],
      },
    ],
    weightSets: [],
    atlasGlyphCount: 2,
    curveCount: 5,
    componentCount: 4,
  };
  const bytes = new Uint8Array(atlas.layout.totalLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(glyphs.offset + 20, 2, true);
  view.setUint32(glyphs.offset + 32 + 20, 3, true);
  view.setUint32(glyphs.offset + 32 + 24, 0x8000_0000, true);
  view.setUint32(componentGlyphs.offset + 12, 4, true);
  return { atlas, bytes };
}

describe("resident Slug frame planning", () => {
  it("captures split descriptors and plans an exact component variant", () => {
    const { atlas, bytes } = residentFixture();
    const sections = createSlugAtlasSections(atlas);
    captureSlugAtlasSections(atlas, sections, 0, bytes.subarray(0, 300));
    captureSlugAtlasSections(atlas, sections, 300, bytes.subarray(300));

    const frame = createSlugFrame(atlas, sections, createSlugGlyphMap(atlas), [
      {
        glyphId: "glyph-a" as GlyphId,
        sourceId: "source-heavy" as SourceId,
        pixelRect: [10, 20, 90, 95],
      },
    ]);

    expect(frame.instanceCount).toBe(1);
    expect(frame.scratch).toEqual({
      curveCount: 3,
      bandCount: 16,
      indexCount: 48,
      glyphCount: 1,
      componentTransformCount: 8,
    });
    expect(new DataView(frame.instances.buffer).getUint32(32, true)).toBe(1);
  });
});
