import { describe, expect, it } from "vitest";
import type {
  GlyphId,
  SlugAtlas as SlugAtlasDescriptor,
  SlugSection,
  SourceId,
} from "@shift/types";
import { SlugAtlas } from "./SlugAtlas";

const emptySection = (): SlugSection => ({ offset: 0, length: 0 });

function residentFixture(): { descriptor: SlugAtlasDescriptor; bytes: Uint8Array<ArrayBuffer> } {
  const glyphs = { offset: 256, length: 64 };
  const componentGlyphs = { offset: 512, length: 24 };
  const descriptor: SlugAtlasDescriptor = {
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
  const bytes = new Uint8Array(descriptor.layout.totalLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(glyphs.offset + 20, 2, true);
  view.setUint32(glyphs.offset + 32 + 20, 3, true);
  view.setUint32(glyphs.offset + 32 + 24, 0x8000_0000, true);
  view.setUint32(componentGlyphs.offset + 12, 4, true);
  return { descriptor, bytes };
}

function buffer(): GPUBuffer {
  return { destroy() {} } as GPUBuffer;
}

describe("resident atlas binding layout", () => {
  it("uses one real partition and one placeholder below the binding limit", () => {
    expect(SlugAtlas.bindingLengths(12, 16)).toEqual([12, 12, 4]);
    expect(SlugAtlas.bindingLengths(16, 16)).toEqual([16, 16, 4]);
  });

  it("splits an atlas that crosses the binding limit", () => {
    expect(SlugAtlas.bindingLengths(24, 16)).toEqual([16, 16, 8]);
    expect(() => SlugAtlas.bindingLengths(36, 16)).toThrow(
      "resident Slug atlas exceeds two storage buffer bindings",
    );
  });

  it("routes a streaming chunk across the split without changing bytes", () => {
    const firstBuffer = buffer();
    const secondBuffer = buffer();
    const writes: { buffer: GPUBuffer; offset: number; bytes: number[] }[] = [];
    const queue = {
      writeBuffer(target: GPUBuffer, offset: number, bytes: Uint8Array<ArrayBuffer>) {
        writes.push({ buffer: target, offset, bytes: Array.from(bytes) });
      },
    } as unknown as GPUQueue;
    const { descriptor } = residentFixture();
    const atlas = new SlugAtlas(descriptor, firstBuffer, secondBuffer, 16);

    atlas.write(queue, 12, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));

    expect(writes).toEqual([
      { buffer: firstBuffer, offset: 12, bytes: [1, 2, 3, 4] },
      { buffer: secondBuffer, offset: 0, bytes: [5, 6, 7, 8] },
    ]);
  });
});

describe("resident atlas frame planning", () => {
  it("packs counts, the split, and resident atlas offsets for the shared shader", () => {
    const { descriptor } = residentFixture();
    const atlas = new SlugAtlas(descriptor, buffer(), buffer(), 128);

    expect(Array.from(atlas.variableParams(3))).toEqual([
      3, 8, 128, 0, 0, 0, 0, 256, 0, 0, 512, 0, 0, 0, 0, 0,
    ]);
  });

  it("captures split descriptors and plans an exact component variant", () => {
    const { descriptor, bytes } = residentFixture();
    const atlas = new SlugAtlas(descriptor, buffer(), buffer(), descriptor.layout.totalLength);
    const queue = { writeBuffer() {} } as unknown as GPUQueue;
    atlas.write(queue, 0, bytes.subarray(0, 300));
    atlas.write(queue, 300, bytes.subarray(300));

    const frame = atlas.frame([
      {
        glyphId: "glyph-a" as GlyphId,
        sourceId: "source-heavy" as SourceId,
        pixelRect: [10, 20, 90, 95],
      },
    ]);

    expect(frame.instanceCount).toBe(1);
    expect(frame.capacity).toEqual({
      curveCount: 3,
      bandCount: 16,
      indexCount: 48,
      glyphCount: 1,
      componentTransformCount: 8,
    });
    expect(new DataView(frame.instances.buffer).getUint32(32, true)).toBe(1);
  });
});
