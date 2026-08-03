import type {
  GlyphPreviewCapacity,
  GlyphPreviewFrame,
  PackedGlyphPreviewFrame,
} from "@/types/glyphPreview";
import { SlugAtlas } from "./SlugAtlas";
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

/** Immutable shader pipelines shared for one resident renderer lifetime. */
export class SlugRendererPipelines {
  readonly resolve: GPUComputePipeline;
  readonly bands: GPUComputePipeline;
  readonly render: GPURenderPipeline;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    const shader = device.createShaderModule({
      label: "shift Slug variable shader",
      code: variableShader,
    });
    this.resolve = device.createComputePipeline({
      label: "shift Slug resolve visible glyphs",
      layout: "auto",
      compute: { module: shader, entryPoint: "resolve_visible_curves" },
    });
    this.bands = device.createComputePipeline({
      label: "shift Slug rebuild visible bands",
      layout: "auto",
      compute: { module: shader, entryPoint: "rebuild_visible_bands" },
    });
    this.render = device.createRenderPipeline({
      label: "shift Slug preview render",
      layout: "auto",
      vertex: { module: shader, entryPoint: "vertex_variable_preview" },
      fragment: {
        module: shader,
        entryPoint: "fragment_variable_preview",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
    });
  }
}

/** Owns mutable frame, scratch, uniform, and bind-group resources. */
export class SlugRendererBuffers {
  readonly #device: GPUDevice;
  readonly #atlas: SlugAtlas;
  readonly #pipelines: SlugRendererPipelines;
  readonly #uniforms;
  readonly #weights: GPUBuffer;

  #instances: GPUBuffer;
  #scratch;
  #groups;
  #instanceCapacity = INSTANCE_BYTES;
  #scratchCapacity: GlyphPreviewCapacity = minimumCapacity();

  constructor(device: GPUDevice, atlas: SlugAtlas, pipelines: SlugRendererPipelines) {
    this.#device = device;
    this.#atlas = atlas;
    this.#pipelines = pipelines;
    this.#uniforms = {
      globals: uniformBuffer(device, "shift Slug globals", GLOBAL_PARAM_BYTES),
      variable: uniformBuffer(device, "shift Slug variable params", VARIABLE_PARAM_BYTES),
      preview: uniformBuffer(device, "shift Slug preview params", PREVIEW_BYTES),
    };
    this.#weights = storageBuffer(
      device,
      "shift Slug weights",
      atlas.weightCount * 4,
      GPUBufferUsage.COPY_DST,
    );
    this.#instances = storageBuffer(
      device,
      "shift Slug instances",
      INSTANCE_BYTES,
      GPUBufferUsage.COPY_DST,
    );
    this.#scratch = createScratch(device, this.#scratchCapacity);
    this.#groups = this.#createGroups();
  }

  get resolveGroups(): readonly GPUBindGroup[] {
    return this.#groups.resolve;
  }

  get bandGroups(): readonly GPUBindGroup[] {
    return this.#groups.bands;
  }

  get renderGroups(): readonly GPUBindGroup[] {
    return this.#groups.render;
  }

  prepare(frame: GlyphPreviewFrame, packed: PackedGlyphPreviewFrame): void {
    this.#ensureCapacity(packed.instances.byteLength, packed.capacity);
    const weights = this.#atlas.weights(frame.location);
    this.#device.queue.writeBuffer(this.#instances, 0, packed.instances);
    this.#device.queue.writeBuffer(this.#weights, 0, weights);
    this.#device.queue.writeBuffer(
      this.#uniforms.globals,
      0,
      new Float32Array([frame.viewportWidth, frame.viewportHeight, 0, 0]),
    );
    this.#device.queue.writeBuffer(
      this.#uniforms.variable,
      0,
      this.#atlas.variableParams(packed.instanceCount),
    );
    this.#device.queue.writeBuffer(
      this.#uniforms.preview,
      0,
      new Float32Array([
        ...frame.style.color,
        frame.style.defaultPixelsPerEm,
        frame.style.metricsTop,
        frame.style.metricsBottom,
        0,
      ]),
    );
  }

  copyPreviewBounds(encoder: GPUCommandEncoder, glyphCount: number): void {
    encoder.copyBufferToBuffer(
      this.#scratch.bounds,
      0,
      this.#scratch.previewBounds,
      0,
      Math.max(1, glyphCount) * BOUNDS_BYTES,
    );
  }

  destroy(): void {
    this.#uniforms.globals.destroy();
    this.#uniforms.variable.destroy();
    this.#uniforms.preview.destroy();
    this.#weights.destroy();
    this.#instances.destroy();
    destroyScratch(this.#scratch);
  }

  #ensureCapacity(instanceBytes: number, capacity: GlyphPreviewCapacity): void {
    const instancesChanged = instanceBytes > this.#instanceCapacity;
    const scratchChanged = exceeds(capacity, this.#scratchCapacity);
    if (!instancesChanged && !scratchChanged) return;

    if (instancesChanged) {
      this.#instances.destroy();
      this.#instanceCapacity = growCapacity(instanceBytes);
      this.#instances = storageBuffer(
        this.#device,
        "shift Slug instances",
        this.#instanceCapacity,
        GPUBufferUsage.COPY_DST,
      );
    }

    if (scratchChanged) {
      destroyScratch(this.#scratch);
      this.#scratchCapacity = growScratch(capacity);
      this.#scratch = createScratch(this.#device, this.#scratchCapacity);
    }

    this.#groups = this.#createGroups();
  }

  #createGroups() {
    return {
      resolve: [
        this.#device.createBindGroup({
          label: "shift Slug resolve instances",
          layout: this.#pipelines.resolve.getBindGroupLayout(0),
          entries: [{ binding: 1, resource: { buffer: this.#instances } }],
        }),
        this.#device.createBindGroup({
          label: "shift Slug resident atlas",
          layout: this.#pipelines.resolve.getBindGroupLayout(1),
          entries: [
            { binding: 0, resource: { buffer: this.#atlas.firstBuffer } },
            { binding: 1, resource: { buffer: this.#weights } },
            { binding: 2, resource: { buffer: this.#uniforms.variable } },
            { binding: 3, resource: { buffer: this.#atlas.secondBuffer } },
          ],
        }),
        this.#device.createBindGroup({
          label: "shift Slug resolve scratch",
          layout: this.#pipelines.resolve.getBindGroupLayout(2),
          entries: [
            { binding: 0, resource: { buffer: this.#scratch.curves } },
            { binding: 3, resource: { buffer: this.#scratch.bounds } },
            { binding: 4, resource: { buffer: this.#scratch.advances } },
            { binding: 5, resource: { buffer: this.#scratch.componentTransforms } },
          ],
        }),
      ],
      bands: [
        this.#device.createBindGroup({
          label: "shift Slug band instances",
          layout: this.#pipelines.bands.getBindGroupLayout(0),
          entries: [{ binding: 1, resource: { buffer: this.#instances } }],
        }),
        this.#device.createBindGroup({
          label: "shift Slug band atlas",
          layout: this.#pipelines.bands.getBindGroupLayout(1),
          entries: [
            { binding: 0, resource: { buffer: this.#atlas.firstBuffer } },
            { binding: 2, resource: { buffer: this.#uniforms.variable } },
            { binding: 3, resource: { buffer: this.#atlas.secondBuffer } },
          ],
        }),
        this.#device.createBindGroup({
          label: "shift Slug band scratch",
          layout: this.#pipelines.bands.getBindGroupLayout(2),
          entries: [
            { binding: 0, resource: { buffer: this.#scratch.curves } },
            { binding: 1, resource: { buffer: this.#scratch.bands } },
            { binding: 2, resource: { buffer: this.#scratch.indexes } },
            { binding: 3, resource: { buffer: this.#scratch.bounds } },
          ],
        }),
      ],
      render: [
        this.#device.createBindGroup({
          label: "shift Slug render globals",
          layout: this.#pipelines.render.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.#uniforms.globals } },
            { binding: 1, resource: { buffer: this.#instances } },
          ],
        }),
        this.#device.createBindGroup({
          label: "shift Slug render variable params",
          layout: this.#pipelines.render.getBindGroupLayout(1),
          entries: [{ binding: 2, resource: { buffer: this.#uniforms.variable } }],
        }),
        this.#device.createBindGroup({
          label: "shift Slug render scratch",
          layout: this.#pipelines.render.getBindGroupLayout(2),
          entries: [
            { binding: 0, resource: { buffer: this.#scratch.curves } },
            { binding: 1, resource: { buffer: this.#scratch.bands } },
            { binding: 2, resource: { buffer: this.#scratch.indexes } },
            { binding: 3, resource: { buffer: this.#scratch.bounds } },
          ],
        }),
        this.#device.createBindGroup({
          label: "shift Slug preview layout",
          layout: this.#pipelines.render.getBindGroupLayout(3),
          entries: [
            { binding: 0, resource: { buffer: this.#scratch.advances } },
            { binding: 1, resource: { buffer: this.#uniforms.preview } },
            { binding: 2, resource: { buffer: this.#scratch.previewBounds } },
          ],
        }),
      ],
    };
  }
}

function minimumCapacity(): GlyphPreviewCapacity {
  return {
    curveCount: 1,
    bandCount: 1,
    indexCount: 1,
    glyphCount: 1,
    componentTransformCount: 1,
  };
}

function growScratch(required: GlyphPreviewCapacity): GlyphPreviewCapacity {
  return {
    curveCount: growCapacity(required.curveCount),
    bandCount: growCapacity(required.bandCount),
    indexCount: growCapacity(required.indexCount),
    glyphCount: growCapacity(required.glyphCount),
    componentTransformCount: growCapacity(required.componentTransformCount),
  };
}

function exceeds(required: GlyphPreviewCapacity, capacity: GlyphPreviewCapacity): boolean {
  return (
    required.curveCount > capacity.curveCount ||
    required.bandCount > capacity.bandCount ||
    required.indexCount > capacity.indexCount ||
    required.glyphCount > capacity.glyphCount ||
    required.componentTransformCount > capacity.componentTransformCount
  );
}

function createScratch(device: GPUDevice, capacity: GlyphPreviewCapacity) {
  return {
    curves: storageBuffer(device, "shift Slug curves", capacity.curveCount * CURVE_BYTES),
    bands: storageBuffer(device, "shift Slug bands", capacity.bandCount * BAND_BYTES),
    indexes: storageBuffer(device, "shift Slug indexes", capacity.indexCount * INDEX_BYTES),
    bounds: storageBuffer(
      device,
      "shift Slug bounds",
      capacity.glyphCount * BOUNDS_BYTES,
      GPUBufferUsage.COPY_SRC,
    ),
    previewBounds: storageBuffer(
      device,
      "shift Slug preview bounds",
      capacity.glyphCount * BOUNDS_BYTES,
      GPUBufferUsage.COPY_DST,
    ),
    advances: storageBuffer(device, "shift Slug advances", capacity.glyphCount * ADVANCE_BYTES),
    componentTransforms: storageBuffer(
      device,
      "shift Slug component transforms",
      capacity.componentTransformCount * COMPONENT_TRANSFORM_BYTES,
    ),
  };
}

function destroyScratch(scratch: ReturnType<typeof createScratch>): void {
  scratch.curves.destroy();
  scratch.bands.destroy();
  scratch.indexes.destroy();
  scratch.bounds.destroy();
  scratch.previewBounds.destroy();
  scratch.advances.destroy();
  scratch.componentTransforms.destroy();
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

function growCapacity(required: number): number {
  if (required <= 0) return 1;
  return 2 ** Math.ceil(Math.log2(required));
}
