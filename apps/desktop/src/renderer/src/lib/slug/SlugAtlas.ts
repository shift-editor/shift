import type { Axis, SlugAtlas, SlugGlyph, SlugSection, SourceId } from "@shift/types";
import { interpolationWeights } from "@/lib/interpolation/InterpolationBasis";
import type { AxisLocation } from "@/types/variation";
import type { SlugAtlasSections, SlugFrame, SlugGlyphMap, SlugGlyphSelection } from "@/types/slug";

const VARIABLE_GLYPH_BYTES = 32;
const COMPONENT_GLYPH_BYTES = 24;
const INSTANCE_BYTES = 48;
const COMPONENT_GLYPH_FLAG = 0x8000_0000;
const GLYPH_OFFSET_MASK = 0x7fff_ffff;

export function createSlugGlyphMap(atlas: SlugAtlas): SlugGlyphMap {
  return new Map(atlas.glyphs.map((glyph) => [glyph.glyphId, glyph]));
}

export function slugWeights(
  atlas: SlugAtlas,
  location: AxisLocation,
  axes: readonly Axis[],
): Float32Array<ArrayBuffer> {
  const weights = new Float32Array(atlas.weightCount);
  weights[0] = 1;
  for (const set of atlas.weightSets) {
    const basisWeights = interpolationWeights(set.basis, location, axes);
    for (let sourceIndex = 0; sourceIndex < set.sourceWeightIndices.length; sourceIndex += 1) {
      const weightIndex = set.sourceWeightIndices[sourceIndex];
      if (weightIndex === undefined || weightIndex >= weights.length) {
        throw new Error("resident Slug weight index is out of range");
      }
      weights[weightIndex] = basisWeights[sourceIndex] ?? 0;
    }
  }
  return weights;
}

export function createSlugAtlasSections(atlas: SlugAtlas): SlugAtlasSections {
  return {
    glyphs: new Uint8Array(atlas.layout.glyphs.length),
    componentGlyphs: new Uint8Array(atlas.layout.componentGlyphs.length),
  };
}

export function captureSlugAtlasSections(
  atlas: SlugAtlas,
  sections: SlugAtlasSections,
  chunkOffset: number,
  bytes: Uint8Array,
): void {
  copyOverlap(sections.glyphs, atlas.layout.glyphs, chunkOffset, bytes);
  copyOverlap(sections.componentGlyphs, atlas.layout.componentGlyphs, chunkOffset, bytes);
}

export function createSlugFrame(
  atlas: SlugAtlas,
  sections: SlugAtlasSections,
  glyphs: SlugGlyphMap,
  selections: readonly SlugGlyphSelection[],
): SlugFrame {
  if (sections.glyphs.byteLength % VARIABLE_GLYPH_BYTES !== 0) {
    throw new Error("invalid resident Slug glyph section length");
  }
  if (sections.componentGlyphs.byteLength % COMPONENT_GLYPH_BYTES !== 0) {
    throw new Error("invalid resident Slug component-glyph section length");
  }

  const glyphView = new DataView(
    sections.glyphs.buffer,
    sections.glyphs.byteOffset,
    sections.glyphs.byteLength,
  );
  const componentView = new DataView(
    sections.componentGlyphs.buffer,
    sections.componentGlyphs.byteOffset,
    sections.componentGlyphs.byteLength,
  );
  const instances = new Uint8Array(selections.length * INSTANCE_BYTES);
  const instanceView = new DataView(instances.buffer);
  const bandsPerGlyph = atlas.bandCount * 2;
  let curveCount = 0;
  let bandCount = 0;
  let indexCount = 0;
  let componentTransformCount = 0;

  for (let instanceIndex = 0; instanceIndex < selections.length; instanceIndex += 1) {
    const selection = selections[instanceIndex]!;
    const glyph = glyphs.get(selection.glyphId);
    if (!glyph) throw new Error(`resident Slug glyph ${selection.glyphId} is missing`);

    const glyphIndex = selectedGlyphIndex(glyph, selection.sourceId);
    const glyphOffset = glyphIndex * VARIABLE_GLYPH_BYTES;
    if (glyphOffset + VARIABLE_GLYPH_BYTES > glyphView.byteLength) {
      throw new Error(`resident Slug glyph index ${glyphIndex} is out of range`);
    }

    const glyphCurveCount = glyphView.getUint32(glyphOffset + 20, true);
    const sourceStart = glyphView.getUint32(glyphOffset + 24, true);
    const instanceOffset = instanceIndex * INSTANCE_BYTES;
    for (let valueIndex = 0; valueIndex < 4; valueIndex += 1) {
      instanceView.setFloat32(
        instanceOffset + valueIndex * 4,
        selection.pixelRect[valueIndex]!,
        true,
      );
    }
    // Preview layout is resolved from GPU advances by vertex_variable_preview.
    for (let valueIndex = 0; valueIndex < 4; valueIndex += 1) {
      instanceView.setFloat32(instanceOffset + 16 + valueIndex * 4, 0, true);
    }
    instanceView.setUint32(instanceOffset + 32, glyphIndex, true);
    instanceView.setUint32(instanceOffset + 36, curveCount, true);
    instanceView.setUint32(instanceOffset + 40, bandCount, true);
    instanceView.setUint32(instanceOffset + 44, indexCount, true);

    curveCount = checkedAdd(curveCount, glyphCurveCount, "curve scratch");
    bandCount = checkedAdd(bandCount, bandsPerGlyph, "band scratch");
    indexCount = checkedAdd(
      indexCount,
      checkedMultiply(glyphCurveCount, bandsPerGlyph, "index scratch"),
      "index scratch",
    );

    if ((sourceStart & COMPONENT_GLYPH_FLAG) === 0) continue;

    const componentGlyphIndex = sourceStart & GLYPH_OFFSET_MASK;
    const componentOffset = componentGlyphIndex * COMPONENT_GLYPH_BYTES;
    if (componentOffset + COMPONENT_GLYPH_BYTES > componentView.byteLength) {
      throw new Error(`resident Slug component glyph ${componentGlyphIndex} is out of range`);
    }
    const componentCount = componentView.getUint32(componentOffset + 12, true);
    componentTransformCount = checkedAdd(
      componentTransformCount,
      checkedMultiply(componentCount, 2, "component transform scratch"),
      "component transform scratch",
    );
  }

  return {
    instances,
    instanceCount: selections.length,
    scratch: {
      curveCount,
      bandCount,
      indexCount,
      glyphCount: selections.length,
      componentTransformCount,
    },
  };
}

function selectedGlyphIndex(glyph: SlugGlyph, sourceId: SourceId | null): number {
  if (sourceId === null) return glyph.defaultGlyph;

  return (
    glyph.exactSources.find((source) => source.sourceId === sourceId)?.glyphIndex ??
    glyph.defaultGlyph
  );
}

function copyOverlap(
  target: Uint8Array,
  section: SlugSection,
  chunkOffset: number,
  bytes: Uint8Array,
): void {
  const chunkEnd = chunkOffset + bytes.byteLength;
  const sectionEnd = section.offset + section.length;
  const start = Math.max(chunkOffset, section.offset);
  const end = Math.min(chunkEnd, sectionEnd);
  if (end <= start) return;

  target.set(bytes.subarray(start - chunkOffset, end - chunkOffset), start - section.offset);
}

function checkedAdd(left: number, right: number, kind: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result > 0xffff_ffff) {
    throw new Error(`${kind} exceeds u32`);
  }
  return result;
}

function checkedMultiply(left: number, right: number, kind: string): number {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result > 0xffff_ffff) {
    throw new Error(`${kind} exceeds u32`);
  }
  return result;
}
