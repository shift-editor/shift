import type { Axis, SlugAtlas } from "@shift/types";
import type { AxisLocation } from "@/types/variation";
import type {
  SlugAtlasSections,
  SlugDiagnostics,
  SlugDraw,
  SlugRendererOptions,
  SlugScratch,
} from "@/types/slug";
import {
  createSlugFrame,
  createSlugGlyphMap,
  createSlugVariableParams,
  slugWeights,
} from "./SlugAtlas";
import variableShader from "../../../../../../../crates/shift-slug/shaders/slug-variable.wgsl?raw";

const INSTANCE_BYTES = 48;
const CURVE_BYTES = 24;
const BAND_BYTES = 8;
const INDEX_BYTES = 4;
const BOUNDS_BYTES = 16;
const ADVANCE_BYTES = 4;
const COMPONENT_TRANSFORM_BYTES = 32;
const PREVIEW_BYTES = 32;
const GLOBAL_PARAM_BYTES = 16;
const VARIABLE_PARAM_BYTES = 64;

/** Owns one WebGPU generation for Slug catalog previews. */
export class SlugRenderer {
  readonly #atlas: SlugAtlas;
  readonly #residentAtlas: SlugRendererOptions["residentAtlas"];
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
  #instanceCapacity = INSTANCE_BYTES;
  #scratchCapacity: SlugScratch = {
    curveCount: 1,
    bandCount: 1,
    indexCount: 1,
    glyphCount: 1,
    componentTransformCount: 1,
  };
  #disposed = false;
  #atlasUploadBytes = 0;
  #weightUploadBytes = 0;
  #instanceUploadBytes = 0;
  #frames = 0;
  #deviceLosses = 0;

  constructor(options: SlugRendererOptions) {
    this.#atlas = options.atlas;
    this.#residentAtlas = options.residentAtlas;
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

    this.#globalBuffer = uniformBuffer(this.#device, "shift Slug globals", GLOBAL_PARAM_BYTES);
    this.#variableBuffer = uniformBuffer(
      this.#device,
      "shift Slug variable params",
      VARIABLE_PARAM_BYTES,
    );
    this.#previewBuffer = uniformBuffer(this.#device, "shift Slug preview params", PREVIEW_BYTES);
    this.#weightBuffer = storageBuffer(
      this.#device,
      "shift Slug weights",
      this.#atlas.weightCount * 4,
      GPUBufferUsage.COPY_DST,
    );
    this.#instanceBuffer = storageBuffer(this.#device, "shift Slug instances", INSTANCE_BYTES);
    this.#resolvedCurveBuffer = storageBuffer(this.#device, "shift Slug curves", CURVE_BYTES);
    this.#resolvedBandBuffer = storageBuffer(this.#device, "shift Slug bands", BAND_BYTES);
    this.#resolvedIndexBuffer = storageBuffer(this.#device, "shift Slug indexes", INDEX_BYTES);
    this.#resolvedBoundsBuffer = storageBuffer(this.#device, "shift Slug bounds", BOUNDS_BYTES);
    this.#resolvedAdvanceBuffer = storageBuffer(this.#device, "shift Slug advances", ADVANCE_BYTES);
    this.#resolvedComponentTransformBuffer = storageBuffer(
      this.#device,
      "shift Slug component transforms",
      COMPONENT_TRANSFORM_BYTES,
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
      GLOBAL_PARAM_BYTES +
      VARIABLE_PARAM_BYTES;
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
      if (frame.selections.length === 0) this.#clear();

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
      createSlugVariableParams(this.#atlas, packed.instanceCount, this.#residentAtlas.splitOffset),
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
    this.#residentAtlas.firstBuffer.destroy();
    this.#residentAtlas.secondBuffer.destroy();
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
          { binding: 0, resource: { buffer: this.#residentAtlas.firstBuffer } },
          { binding: 1, resource: { buffer: this.#weightBuffer } },
          { binding: 2, resource: { buffer: this.#variableBuffer } },
          { binding: 3, resource: { buffer: this.#residentAtlas.secondBuffer } },
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
          { binding: 0, resource: { buffer: this.#residentAtlas.firstBuffer } },
          { binding: 2, resource: { buffer: this.#variableBuffer } },
          { binding: 3, resource: { buffer: this.#residentAtlas.secondBuffer } },
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
        entries: [{ binding: 2, resource: { buffer: this.#variableBuffer } }],
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
    this.#residentAtlas.firstBuffer.destroy();
    this.#residentAtlas.secondBuffer.destroy();
    this.#onDeviceLost(reason);
  }
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
