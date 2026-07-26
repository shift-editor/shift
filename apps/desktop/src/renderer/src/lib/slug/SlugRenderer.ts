import type { Axis, SlugAtlas, SlugSection } from "@shift/types";
import type { AxisLocation } from "@/types/variation";
import type {
  SlugAtlasSections,
  SlugDiagnostics,
  SlugDraw,
  SlugRendererOptions,
  SlugScratch,
} from "@/types/slug";
import { createSlugFrame, createSlugGlyphMap, slugWeights } from "./SlugAtlas";
import variableShader from "../../../../../../../crates/shift-slug/shaders/slug-variable.wgsl?raw";

const CURVE_BYTES = 24;
const BAND_BYTES = 8;
const INDEX_BYTES = 4;
const BOUNDS_BYTES = 16;
const ADVANCE_BYTES = 4;
const COMPONENT_TRANSFORM_BYTES = 32;
const PREVIEW_BYTES = 32;
const PARAM_BYTES = 16;

/** Owns one WebGPU generation for the home-grid Slug fill. */
export class SlugRenderer {
  readonly #atlas: SlugAtlas;
  readonly #atlasBuffer: GPUBuffer;
  readonly #sections: SlugAtlasSections;
  readonly #device: GPUDevice;
  readonly #context: GPUCanvasContext;
  readonly #format: GPUTextureFormat;
  readonly #onDeviceLost: (reason: string) => void;
  readonly #glyphs;
  readonly #resolvePipeline: GPUComputePipeline;
  readonly #bandPipeline: GPUComputePipeline;
  readonly #renderPipeline: GPURenderPipeline;
  readonly #globalBuffer: GPUBuffer;
  readonly #variableBuffer: GPUBuffer;
  readonly #previewBuffer: GPUBuffer;
  readonly #weightBuffer: GPUBuffer;

  #instanceBuffer: GPUBuffer;
  #resolvedCurveBuffer: GPUBuffer;
  #resolvedBandBuffer: GPUBuffer;
  #resolvedIndexBuffer: GPUBuffer;
  #resolvedBoundsBuffer: GPUBuffer;
  #resolvedAdvanceBuffer: GPUBuffer;
  #resolvedComponentTransformBuffer: GPUBuffer;
  #resolveGroups: readonly GPUBindGroup[] = [];
  #bandGroups: readonly GPUBindGroup[] = [];
  #renderGroups: readonly GPUBindGroup[] = [];
  #instanceCapacity = 0;
  #scratchCapacity: SlugScratch = {
    curveCount: 0,
    bandCount: 0,
    indexCount: 0,
    glyphCount: 0,
    componentTransformCount: 0,
  };
  #disposed = false;
  #atlasUploadBytes = 0;
  #weightUploadBytes = 0;
  #instanceUploadBytes = 0;
  #frames = 0;
  #deviceLosses = 0;

  constructor(options: SlugRendererOptions) {
    this.#atlas = options.atlas;
    this.#atlasBuffer = options.atlasBuffer;
    this.#sections = options.sections;
    this.#device = options.device;
    this.#context = options.context;
    this.#format = options.format;
    this.#onDeviceLost = options.onDeviceLost;
    this.#glyphs = createSlugGlyphMap(options.atlas);

    const shader = this.#device.createShaderModule({
      label: "shift Slug variable shader",
      code: variableShader,
    });
    this.#resolvePipeline = this.#device.createComputePipeline({
      label: "shift Slug resolve visible glyphs",
      layout: "auto",
      compute: { module: shader, entryPoint: "resolve_visible_curves" },
    });
    this.#bandPipeline = this.#device.createComputePipeline({
      label: "shift Slug rebuild visible bands",
      layout: "auto",
      compute: { module: shader, entryPoint: "rebuild_visible_bands" },
    });
    this.#renderPipeline = this.#device.createRenderPipeline({
      label: "shift Slug preview render",
      layout: "auto",
      vertex: { module: shader, entryPoint: "vertex_variable_preview" },
      fragment: {
        module: shader,
        entryPoint: "fragment_variable_preview",
        targets: [{ format: this.#format }],
      },
      primitive: { topology: "triangle-list" },
    });

    this.#globalBuffer = uniformBuffer(this.#device, "shift Slug globals", PARAM_BYTES);
    this.#variableBuffer = uniformBuffer(this.#device, "shift Slug variable params", PARAM_BYTES);
    this.#previewBuffer = uniformBuffer(this.#device, "shift Slug preview params", PREVIEW_BYTES);
    this.#weightBuffer = storageBuffer(
      this.#device,
      "shift Slug weights",
      this.#atlas.weightCount * 4,
      GPUBufferUsage.COPY_DST,
    );
    this.#instanceBuffer = storageBuffer(this.#device, "shift Slug instances", 4);
    this.#resolvedCurveBuffer = storageBuffer(this.#device, "shift Slug curves", 4);
    this.#resolvedBandBuffer = storageBuffer(this.#device, "shift Slug bands", 4);
    this.#resolvedIndexBuffer = storageBuffer(this.#device, "shift Slug indexes", 4);
    this.#resolvedBoundsBuffer = storageBuffer(this.#device, "shift Slug bounds", 4);
    this.#resolvedAdvanceBuffer = storageBuffer(this.#device, "shift Slug advances", 4);
    this.#resolvedComponentTransformBuffer = storageBuffer(
      this.#device,
      "shift Slug component transforms",
      4,
    );
    this.#createBindGroups();

    this.#device.addEventListener("uncapturederror", (event) => {
      if (this.#disposed) return;
      this.#lose(`uncaptured WebGPU error: ${event.error.message}`);
    });
    void this.#watchDeviceLoss();
  }

  set atlasUploadBytes(value: number) {
    this.#atlasUploadBytes = value;
  }

  weights(location: AxisLocation, axes: readonly Axis[]): Float32Array<ArrayBuffer> {
    return slugWeights(this.#atlas, location, axes);
  }

  get diagnostics(): SlugDiagnostics {
    const residentBufferBytes = Math.max(4, this.#atlas.layout.totalLength);
    const scratchBufferBytes =
      Math.max(4, this.#scratchCapacity.curveCount * CURVE_BYTES) +
      Math.max(4, this.#scratchCapacity.bandCount * BAND_BYTES) +
      Math.max(4, this.#scratchCapacity.indexCount * INDEX_BYTES) +
      Math.max(4, this.#scratchCapacity.glyphCount * BOUNDS_BYTES) +
      Math.max(4, this.#scratchCapacity.glyphCount * ADVANCE_BYTES) +
      Math.max(4, this.#scratchCapacity.componentTransformCount * COMPONENT_TRANSFORM_BYTES);
    const allocatedBufferBytes =
      residentBufferBytes +
      scratchBufferBytes +
      Math.max(4, this.#atlas.weightCount * 4) +
      Math.max(4, this.#instanceCapacity) +
      PREVIEW_BYTES +
      PARAM_BYTES * 2;
    return {
      atlasUploadBytes: this.#atlasUploadBytes,
      residentBufferBytes,
      scratchBufferBytes,
      allocatedBufferBytes,
      geometryUploads: 0,
      geometryUploadBytes: 0,
      weightUploadBytes: this.#weightUploadBytes,
      instanceUploadBytes: this.#instanceUploadBytes,
      frames: this.#frames,
      deviceLosses: this.#deviceLosses,
    };
  }

  draw(frame: SlugDraw): void {
    if (this.#disposed) return;

    const packed = createSlugFrame(this.#atlas, this.#sections, this.#glyphs, frame.selections);
    this.#ensureCapacity(packed.instances.byteLength, packed.scratch);
    if (packed.instanceCount === 0) {
      this.#clear();
      return;
    }

    this.#device.queue.writeBuffer(this.#instanceBuffer, 0, packed.instances);
    this.#device.queue.writeBuffer(this.#weightBuffer, 0, frame.weights);
    this.#device.queue.writeBuffer(
      this.#globalBuffer,
      0,
      new Float32Array([frame.viewportWidth, frame.viewportHeight, 0, 0]),
    );
    this.#device.queue.writeBuffer(
      this.#variableBuffer,
      0,
      new Uint32Array([packed.instanceCount, this.#atlas.bandCount, 0, 0]),
    );
    this.#device.queue.writeBuffer(
      this.#previewBuffer,
      0,
      new Float32Array([
        ...frame.preview.color,
        frame.preview.viewHeight,
        frame.preview.fontTop,
        frame.preview.previewHeight,
        frame.preview.sideMargin,
      ]),
    );
    this.#weightUploadBytes += frame.weights.byteLength;
    this.#instanceUploadBytes += packed.instances.byteLength;

    const encoder = this.#device.createCommandEncoder({ label: "shift Slug frame" });
    {
      const pass = encoder.beginComputePass({ label: "shift Slug resolve" });
      pass.setPipeline(this.#resolvePipeline);
      setGroups(pass, this.#resolveGroups);
      pass.dispatchWorkgroups(packed.instanceCount);
      pass.end();
    }
    {
      const pass = encoder.beginComputePass({ label: "shift Slug bands" });
      pass.setPipeline(this.#bandPipeline);
      setGroups(pass, this.#bandGroups);
      pass.dispatchWorkgroups(packed.instanceCount * this.#atlas.bandCount * 2);
      pass.end();
    }
    {
      const pass = encoder.beginRenderPass({
        label: "shift Slug render",
        colorAttachments: [
          {
            view: this.#context.getCurrentTexture().createView(),
            loadOp: "clear",
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(this.#renderPipeline);
      setGroups(pass, this.#renderGroups);
      pass.draw(6, packed.instanceCount);
      pass.end();
    }
    this.#device.queue.submit([encoder.finish()]);
    this.#frames += 1;
  }

  async complete(): Promise<void> {
    await this.#device.queue.onSubmittedWorkDone();
  }

  destroy(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#context.unconfigure();
    this.#device.destroy();
    this.#atlasBuffer.destroy();
  }

  #ensureCapacity(instanceBytes: number, scratch: SlugScratch): void {
    const instancesChanged = instanceBytes > this.#instanceCapacity;
    const scratchChanged =
      scratch.curveCount > this.#scratchCapacity.curveCount ||
      scratch.bandCount > this.#scratchCapacity.bandCount ||
      scratch.indexCount > this.#scratchCapacity.indexCount ||
      scratch.glyphCount > this.#scratchCapacity.glyphCount ||
      scratch.componentTransformCount > this.#scratchCapacity.componentTransformCount;
    if (!instancesChanged && !scratchChanged) return;

    if (instancesChanged) {
      this.#instanceBuffer.destroy();
      this.#instanceCapacity = growCapacity(instanceBytes);
      this.#instanceBuffer = storageBuffer(
        this.#device,
        "shift Slug instances",
        this.#instanceCapacity,
        GPUBufferUsage.COPY_DST,
      );
    }
    if (scratchChanged) {
      this.#replaceScratch(scratch);
    }
    this.#createBindGroups();
  }

  #replaceScratch(required: SlugScratch): void {
    this.#resolvedCurveBuffer.destroy();
    this.#resolvedBandBuffer.destroy();
    this.#resolvedIndexBuffer.destroy();
    this.#resolvedBoundsBuffer.destroy();
    this.#resolvedAdvanceBuffer.destroy();
    this.#resolvedComponentTransformBuffer.destroy();
    this.#scratchCapacity = {
      curveCount: growCapacity(required.curveCount),
      bandCount: growCapacity(required.bandCount),
      indexCount: growCapacity(required.indexCount),
      glyphCount: growCapacity(required.glyphCount),
      componentTransformCount: growCapacity(required.componentTransformCount),
    };
    this.#resolvedCurveBuffer = storageBuffer(
      this.#device,
      "shift Slug curves",
      this.#scratchCapacity.curveCount * CURVE_BYTES,
    );
    this.#resolvedBandBuffer = storageBuffer(
      this.#device,
      "shift Slug bands",
      this.#scratchCapacity.bandCount * BAND_BYTES,
    );
    this.#resolvedIndexBuffer = storageBuffer(
      this.#device,
      "shift Slug indexes",
      this.#scratchCapacity.indexCount * INDEX_BYTES,
    );
    this.#resolvedBoundsBuffer = storageBuffer(
      this.#device,
      "shift Slug bounds",
      this.#scratchCapacity.glyphCount * BOUNDS_BYTES,
    );
    this.#resolvedAdvanceBuffer = storageBuffer(
      this.#device,
      "shift Slug advances",
      this.#scratchCapacity.glyphCount * ADVANCE_BYTES,
    );
    this.#resolvedComponentTransformBuffer = storageBuffer(
      this.#device,
      "shift Slug component transforms",
      this.#scratchCapacity.componentTransformCount * COMPONENT_TRANSFORM_BYTES,
    );
  }

  #createBindGroups(): void {
    this.#resolveGroups = [
      this.#device.createBindGroup({
        label: "shift Slug resolve instances",
        layout: this.#resolvePipeline.getBindGroupLayout(0),
        entries: [{ binding: 1, resource: { buffer: this.#instanceBuffer } }],
      }),
      this.#device.createBindGroup({
        label: "shift Slug resident atlas",
        layout: this.#resolvePipeline.getBindGroupLayout(1),
        entries: [
          atlasEntry(0, this.#atlasBuffer, this.#atlas.layout.baseCurves),
          atlasEntry(1, this.#atlasBuffer, this.#atlas.layout.curveDeltas),
          atlasEntry(2, this.#atlasBuffer, this.#atlas.layout.glyphs),
          atlasEntry(3, this.#atlasBuffer, this.#atlas.layout.sources),
          { binding: 4, resource: { buffer: this.#weightBuffer } },
          { binding: 5, resource: { buffer: this.#variableBuffer } },
          atlasEntry(6, this.#atlasBuffer, this.#atlas.layout.lineBits),
          atlasEntry(7, this.#atlasBuffer, this.#atlas.layout.sparseDeltas),
          atlasEntry(8, this.#atlasBuffer, this.#atlas.layout.sourceAdvances),
          atlasEntry(9, this.#atlasBuffer, this.#atlas.layout.componentGlyphs),
          atlasEntry(10, this.#atlasBuffer, this.#atlas.layout.componentParts),
          atlasEntry(11, this.#atlasBuffer, this.#atlas.layout.components),
          atlasEntry(12, this.#atlasBuffer, this.#atlas.layout.componentSources),
          atlasEntry(13, this.#atlasBuffer, this.#atlas.layout.anchorSources),
        ],
      }),
      this.#device.createBindGroup({
        label: "shift Slug resolve scratch",
        layout: this.#resolvePipeline.getBindGroupLayout(2),
        entries: [
          { binding: 0, resource: { buffer: this.#resolvedCurveBuffer } },
          { binding: 3, resource: { buffer: this.#resolvedBoundsBuffer } },
          { binding: 4, resource: { buffer: this.#resolvedAdvanceBuffer } },
          { binding: 5, resource: { buffer: this.#resolvedComponentTransformBuffer } },
        ],
      }),
    ];
    this.#bandGroups = [
      this.#device.createBindGroup({
        label: "shift Slug band instances",
        layout: this.#bandPipeline.getBindGroupLayout(0),
        entries: [{ binding: 1, resource: { buffer: this.#instanceBuffer } }],
      }),
      this.#device.createBindGroup({
        label: "shift Slug band atlas",
        layout: this.#bandPipeline.getBindGroupLayout(1),
        entries: [
          atlasEntry(2, this.#atlasBuffer, this.#atlas.layout.glyphs),
          { binding: 5, resource: { buffer: this.#variableBuffer } },
        ],
      }),
      this.#device.createBindGroup({
        label: "shift Slug band scratch",
        layout: this.#bandPipeline.getBindGroupLayout(2),
        entries: [
          { binding: 0, resource: { buffer: this.#resolvedCurveBuffer } },
          { binding: 1, resource: { buffer: this.#resolvedBandBuffer } },
          { binding: 2, resource: { buffer: this.#resolvedIndexBuffer } },
          { binding: 3, resource: { buffer: this.#resolvedBoundsBuffer } },
        ],
      }),
    ];
    this.#renderGroups = [
      this.#device.createBindGroup({
        label: "shift Slug render globals",
        layout: this.#renderPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.#globalBuffer } },
          { binding: 1, resource: { buffer: this.#instanceBuffer } },
        ],
      }),
      this.#device.createBindGroup({
        label: "shift Slug render variable params",
        layout: this.#renderPipeline.getBindGroupLayout(1),
        entries: [{ binding: 5, resource: { buffer: this.#variableBuffer } }],
      }),
      this.#device.createBindGroup({
        label: "shift Slug render scratch",
        layout: this.#renderPipeline.getBindGroupLayout(2),
        entries: [
          { binding: 0, resource: { buffer: this.#resolvedCurveBuffer } },
          { binding: 1, resource: { buffer: this.#resolvedBandBuffer } },
          { binding: 2, resource: { buffer: this.#resolvedIndexBuffer } },
          { binding: 3, resource: { buffer: this.#resolvedBoundsBuffer } },
        ],
      }),
      this.#device.createBindGroup({
        label: "shift Slug preview layout",
        layout: this.#renderPipeline.getBindGroupLayout(3),
        entries: [
          { binding: 0, resource: { buffer: this.#resolvedAdvanceBuffer } },
          { binding: 1, resource: { buffer: this.#previewBuffer } },
        ],
      }),
    ];
  }

  #clear(): void {
    const encoder = this.#device.createCommandEncoder({ label: "shift Slug clear" });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.#context.getCurrentTexture().createView(),
          loadOp: "clear",
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          storeOp: "store",
        },
      ],
    });
    pass.end();
    this.#device.queue.submit([encoder.finish()]);
  }

  async #watchDeviceLoss(): Promise<void> {
    try {
      const loss = await this.#device.lost;
      if (this.#disposed) return;
      this.#lose(`WebGPU device lost: ${loss.reason} ${loss.message}`.trim());
    } catch (error) {
      if (this.#disposed) return;
      this.#lose(`WebGPU device loss watcher failed: ${String(error)}`);
    }
  }

  #lose(reason: string): void {
    if (this.#disposed) return;
    this.#deviceLosses += 1;
    this.#disposed = true;
    this.#context.unconfigure();
    this.#device.destroy();
    this.#atlasBuffer.destroy();
    this.#onDeviceLost(reason);
  }
}

export function largestSlugBinding(atlas: SlugAtlas): number {
  return Math.max(
    4,
    atlas.layout.baseCurves.length,
    atlas.layout.curveDeltas.length,
    atlas.layout.sparseDeltas.length,
    atlas.layout.glyphs.length,
    atlas.layout.sources.length,
    atlas.layout.sourceAdvances.length,
    atlas.layout.componentGlyphs.length,
    atlas.layout.componentParts.length,
    atlas.layout.components.length,
    atlas.layout.componentSources.length,
    atlas.layout.anchorSources.length,
    atlas.layout.lineBits.length,
  );
}

function uniformBuffer(device: GPUDevice, label: string, size: number): GPUBuffer {
  return device.createBuffer({
    label,
    size,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
}

function storageBuffer(device: GPUDevice, label: string, size: number, extraUsage = 0): GPUBuffer {
  return device.createBuffer({
    label,
    size: Math.max(4, size),
    usage: GPUBufferUsage.STORAGE | extraUsage,
  });
}

function atlasEntry(binding: number, buffer: GPUBuffer, section: SlugSection): GPUBindGroupEntry {
  return {
    binding,
    resource:
      section.length === 0
        ? { buffer, offset: 0, size: 4 }
        : { buffer, offset: section.offset, size: section.length },
  };
}

function setGroups(
  pass: GPUComputePassEncoder | GPURenderPassEncoder,
  groups: readonly GPUBindGroup[],
): void {
  for (let index = 0; index < groups.length; index += 1) {
    pass.setBindGroup(index, groups[index]!);
  }
}

function growCapacity(required: number): number {
  if (required <= 0) return 1;
  return 2 ** Math.ceil(Math.log2(required));
}
