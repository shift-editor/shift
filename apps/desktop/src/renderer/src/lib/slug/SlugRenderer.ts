import type { GlyphPreviewFrame } from "@/types/glyphPreview";
import { SlugAtlas } from "./SlugAtlas";
import { SlugRendererBuffers, SlugRendererPipelines } from "./SlugRendererResources";

/** Concrete Slug implementation behind the resident glyph preview layer. */
export class SlugRenderer {
  readonly #atlas: SlugAtlas;
  readonly #device: GPUDevice;
  readonly #context: GPUCanvasContext;
  readonly #onDeviceLost: (reason: string) => void;
  readonly #pipelines: SlugRendererPipelines;
  readonly #buffers: SlugRendererBuffers;
  #disposed = false;

  constructor(
    atlas: SlugAtlas,
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    onDeviceLost: (reason: string) => void,
  ) {
    this.#atlas = atlas;
    this.#device = device;
    this.#context = context;
    this.#onDeviceLost = onDeviceLost;
    this.#pipelines = new SlugRendererPipelines(device, format);
    this.#buffers = new SlugRendererBuffers(device, atlas, this.#pipelines);

    this.#device.addEventListener("uncapturederror", (event) => {
      if (this.#disposed) return;
      this.#lose(`uncaptured WebGPU error: ${event.error.message}`);
    });
    void this.#watchDeviceLoss();
  }

  draw(frame: GlyphPreviewFrame): void {
    if (this.#disposed) return;

    const packed = this.#atlas.frame(frame.instances);
    if (packed.instanceCount === 0) {
      if (frame.instances.length === 0) this.#clear();
      return;
    }

    this.#buffers.prepare(frame, packed);
    const encoder = this.#device.createCommandEncoder({ label: "shift Slug frame" });
    {
      const pass = encoder.beginComputePass({ label: "shift Slug resolve" });
      pass.setPipeline(this.#pipelines.resolve);
      setGroups(pass, this.#buffers.resolveGroups);
      pass.dispatchWorkgroups(packed.instanceCount);
      pass.end();
    }
    {
      const pass = encoder.beginComputePass({ label: "shift Slug bands" });
      pass.setPipeline(this.#pipelines.bands);
      setGroups(pass, this.#buffers.bandGroups);
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
      pass.setPipeline(this.#pipelines.render);
      setGroups(pass, this.#buffers.renderGroups);
      pass.draw(6, packed.instanceCount);
      pass.end();
    }
    this.#device.queue.submit([encoder.finish()]);
  }

  async complete(): Promise<void> {
    await this.#device.queue.onSubmittedWorkDone();
  }

  destroy(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#release();
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
    this.#disposed = true;
    this.#release();
    this.#onDeviceLost(reason);
  }

  #release(): void {
    this.#context.unconfigure();
    this.#buffers.destroy();
    this.#atlas.destroy();
    this.#device.destroy();
  }
}

function setGroups(
  pass: GPUComputePassEncoder | GPURenderPassEncoder,
  groups: readonly GPUBindGroup[],
): void {
  for (let index = 0; index < groups.length; index += 1) {
    pass.setBindGroup(index, groups[index]!);
  }
}
