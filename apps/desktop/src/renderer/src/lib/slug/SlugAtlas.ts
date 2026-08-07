import type { GlyphId, SlugSection, SourceId } from "@shift/types";
import { interpolationWeights } from "@/lib/interpolation/InterpolationBasis";
import type { AxisLocation } from "@/types/variation";
import type { CatalogLocation } from "@/types/glyphCatalog";
import type { GlyphPreviewInstance, PackedGlyphPreviewFrame } from "@/types/glyphPreview";
import type { GlyphAtlasGlyph, GlyphAtlasPage } from "@/types/glyphAtlas";

const VARIABLE_GLYPH_BYTES = 32;
const COMPONENT_GLYPH_BYTES = 24;
const INSTANCE_BYTES = 48;
const COMPONENT_GLYPH_FLAG = 0x8000_0000;
const GLYPH_OFFSET_MASK = 0x7fff_ffff;

/** One concrete Slug atlas generation resident across two WebGPU bindings. */
export class SlugAtlas {
  readonly #descriptor: GlyphAtlasPage;
  readonly #glyphIds: readonly GlyphId[];
  readonly #glyphs: ReadonlyMap<GlyphId, GlyphAtlasGlyph>;
  readonly #glyphBytes: Uint8Array<ArrayBuffer>;
  readonly #componentGlyphBytes: Uint8Array<ArrayBuffer>;
  readonly #firstBuffer: GPUBuffer;
  readonly #secondBuffer: GPUBuffer;
  readonly #splitOffset: number;
  #resolvedWeights: Float32Array<ArrayBuffer> | null;
  #disposed = false;

  constructor(
    descriptor: GlyphAtlasPage,
    firstBuffer: GPUBuffer,
    secondBuffer: GPUBuffer,
    splitOffset: number,
  ) {
    this.#descriptor = descriptor;
    this.#glyphIds = descriptor.glyphs.map((glyph) => glyph.glyphId);
    this.#glyphs = new Map(descriptor.glyphs.map((glyph) => [glyph.glyphId, glyph]));
    this.#resolvedWeights = descriptor.resolvedWeights
      ? new Float32Array(descriptor.resolvedWeights)
      : null;
    this.#glyphBytes = new Uint8Array(descriptor.layout.glyphs.length);
    this.#componentGlyphBytes = new Uint8Array(descriptor.layout.componentGlyphs.length);
    this.#firstBuffer = firstBuffer;
    this.#secondBuffer = secondBuffer;
    this.#splitOffset = splitOffset;
  }

  static create(
    descriptor: GlyphAtlasPage,
    device: GPUDevice,
    maximumBindingSize: number,
  ): SlugAtlas {
    const [splitOffset, firstLength, secondLength] = SlugAtlas.bindingLengths(
      descriptor.layout.totalLength,
      maximumBindingSize,
    );

    const firstBuffer = device.createBuffer({
      label: "shift Slug resident atlas first",
      size: firstLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    try {
      const secondBuffer = device.createBuffer({
        label: "shift Slug resident atlas second",
        size: secondLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      return new SlugAtlas(descriptor, firstBuffer, secondBuffer, splitOffset);
    } catch (error) {
      firstBuffer.destroy();
      throw error;
    }
  }

  /** Returns split offset and physical buffer lengths for one adapter limit. */
  static bindingLengths(
    totalLength: number,
    maximumBindingSize: number,
  ): readonly [splitOffset: number, firstLength: number, secondLength: number] {
    const alignedMaximum = Math.floor(maximumBindingSize / 4) * 4;
    if (!Number.isSafeInteger(totalLength) || totalLength < 0 || totalLength % 4 !== 0) {
      throw new Error("resident Slug atlas length must be a non-negative multiple of four");
    }
    if (!Number.isSafeInteger(alignedMaximum) || alignedMaximum < 4) {
      throw new Error("resident Slug binding limit is smaller than four bytes");
    }

    const splitOffset = Math.min(totalLength, alignedMaximum);
    const remainingLength = totalLength - splitOffset;
    if (remainingLength > alignedMaximum) {
      throw new Error("resident Slug atlas exceeds two storage buffer bindings");
    }

    return [splitOffset, Math.max(4, splitOffset), Math.max(4, remainingLength)];
  }

  get glyphIds(): readonly GlyphId[] {
    return this.#glyphIds;
  }

  get pageIndex(): number {
    return this.#descriptor.pageIndex;
  }

  get firstBuffer(): GPUBuffer {
    return this.#firstBuffer;
  }

  get secondBuffer(): GPUBuffer {
    return this.#secondBuffer;
  }

  get splitOffset(): number {
    return this.#splitOffset;
  }

  get totalLength(): number {
    return this.#descriptor.layout.totalLength;
  }

  get bandCount(): number {
    return this.#descriptor.bandCount;
  }

  get weightCount(): number {
    return this.#descriptor.weightCount;
  }

  /** Writes one ordered stream chunk and captures CPU descriptors needed per frame. */
  write(queue: GPUQueue, chunkOffset: number, bytes: Uint8Array<ArrayBuffer>): void {
    const firstLength = Math.max(0, Math.min(bytes.byteLength, this.#splitOffset - chunkOffset));
    if (firstLength > 0) {
      queue.writeBuffer(this.#firstBuffer, chunkOffset, bytes.subarray(0, firstLength));
    }

    if (firstLength < bytes.byteLength) {
      const secondBufferOffset = chunkOffset + firstLength - this.#splitOffset;
      queue.writeBuffer(this.#secondBuffer, secondBufferOffset, bytes.subarray(firstLength));
    }

    copyOverlap(this.#glyphBytes, this.#descriptor.layout.glyphs, chunkOffset, bytes);
    copyOverlap(
      this.#componentGlyphBytes,
      this.#descriptor.layout.componentGlyphs,
      chunkOffset,
      bytes,
    );
  }

  weights(coordinates: CatalogLocation): Float32Array<ArrayBuffer> {
    if (this.#resolvedWeights) return this.#resolvedWeights;

    const axes = this.#descriptor.weightAxes;
    if (coordinates.length !== axes.length) {
      throw new Error(
        `resident Slug page ${this.pageIndex} received ${coordinates.length} coordinates for ${axes.length} axes`,
      );
    }
    const location: AxisLocation = new Map(
      axes.map((axis, index) => [axis.id, coordinates[index] ?? axis.default]),
    );
    const weights = new Float32Array(this.#descriptor.weightCount);
    weights[0] = 1;
    for (const set of this.#descriptor.weightSets) {
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

  setResolvedWeights(weights: readonly number[]): void {
    if (weights.length !== this.#descriptor.weightCount) {
      throw new Error(
        `resident Slug page ${this.pageIndex} received ${weights.length} weights; expected ${this.#descriptor.weightCount}`,
      );
    }
    this.#resolvedWeights = new Float32Array(weights);
  }

  variableParams(instanceCount: number): Uint32Array<ArrayBuffer> {
    const atlas = this.#descriptor;
    return new Uint32Array(
      [
        checkedU32(instanceCount, "instance count"),
        atlas.bandCount,
        checkedU32(this.#splitOffset, "resident atlas split offset"),
        0,
        atlas.layout.baseCurves.offset,
        atlas.layout.curveDeltas.offset,
        atlas.layout.sparseDeltas.offset,
        atlas.layout.glyphs.offset,
        atlas.layout.sources.offset,
        atlas.layout.sourceAdvances.offset,
        atlas.layout.componentGlyphs.offset,
        atlas.layout.componentParts.offset,
        atlas.layout.components.offset,
        atlas.layout.componentSources.offset,
        atlas.layout.anchorSources.offset,
        atlas.layout.lineBits.offset,
      ].map((value) => checkedU32(value, "resident atlas offset")),
    );
  }

  /** Packs visible glyph identities into shader instances and exact scratch capacities. */
  frame(instances: readonly GlyphPreviewInstance[]): PackedGlyphPreviewFrame {
    if (this.#glyphBytes.byteLength % VARIABLE_GLYPH_BYTES !== 0) {
      throw new Error("invalid resident Slug glyph section length");
    }
    if (this.#componentGlyphBytes.byteLength % COMPONENT_GLYPH_BYTES !== 0) {
      throw new Error("invalid resident Slug component-glyph section length");
    }

    const glyphView = new DataView(
      this.#glyphBytes.buffer,
      this.#glyphBytes.byteOffset,
      this.#glyphBytes.byteLength,
    );
    const componentView = new DataView(
      this.#componentGlyphBytes.buffer,
      this.#componentGlyphBytes.byteOffset,
      this.#componentGlyphBytes.byteLength,
    );
    const packedInstances = new Uint8Array(instances.length * INSTANCE_BYTES);
    const instanceView = new DataView(packedInstances.buffer);
    const bandsPerGlyph = this.#descriptor.bandCount * 2;
    let curveCount = 0;
    let bandCount = 0;
    let indexCount = 0;
    let componentTransformCount = 0;

    for (let instanceIndex = 0; instanceIndex < instances.length; instanceIndex += 1) {
      const instance = instances[instanceIndex]!;
      const glyph = this.#glyphs.get(instance.glyphId);
      if (!glyph) throw new Error(`resident Slug glyph ${instance.glyphId} is missing`);

      const glyphIndex = selectedGlyphIndex(glyph, instance.sourceId);
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
          instance.pixelRect[valueIndex]!,
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
      instances: packedInstances,
      instanceCount: instances.length,
      capacity: {
        curveCount,
        bandCount,
        indexCount,
        glyphCount: instances.length,
        componentTransformCount,
      },
    };
  }

  destroy(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#firstBuffer.destroy();
    this.#secondBuffer.destroy();
  }
}

function selectedGlyphIndex(glyph: GlyphAtlasGlyph, sourceId: SourceId | null): number {
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
  return checkedU32(left + right, kind);
}

function checkedMultiply(left: number, right: number, kind: string): number {
  return checkedU32(left * right, kind);
}

function checkedU32(value: number, kind: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`${kind} exceeds u32`);
  }

  return value;
}
