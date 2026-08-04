import type { CatalogGlyphKey, GlyphAtlasPageWeights } from "@/types/glyphAtlas";
import type { GlyphPreviewFrame, GlyphPreviewInstance } from "@/types/glyphPreview";
import { SlugAtlas } from "./SlugAtlas";
import { SlugAtlasPage } from "./SlugAtlasPage";
import { SlugRendererPipelines } from "./SlugRendererResources";

/** Complete Slug atlas renderer with independently replaceable fixed pages. */
export class SlugRenderer {
  readonly #device: GPUDevice;
  readonly #context: GPUCanvasContext;
  readonly #onDeviceLost: (reason: string) => void;
  readonly #pipelines: SlugRendererPipelines;
  readonly #pages = new Set<SlugAtlasPage>();
  readonly #pageByGlyph = new Map<CatalogGlyphKey, SlugAtlasPage>();
  #disposed = false;

  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    onDeviceLost: (reason: string) => void,
  ) {
    this.#device = device;
    this.#context = context;
    this.#onDeviceLost = onDeviceLost;
    this.#pipelines = new SlugRendererPipelines(device, format);

    this.#device.addEventListener("uncapturederror", (event) => {
      if (this.#disposed) return;
      this.#lose(`uncaptured WebGPU error: ${event.error.message}`);
    });
    void this.#watchDeviceLoss();
  }

  loadPage(atlas: SlugAtlas): void {
    this.loadPages([atlas]);
  }

  /** Commits a prepared page set in one synchronous glyph-map replacement. */
  loadPages(atlases: readonly SlugAtlas[]): void {
    if (this.#disposed) {
      for (const atlas of atlases) atlas.destroy();
      return;
    }

    const pages: SlugAtlasPage[] = [];
    try {
      for (const atlas of atlases) {
        pages.push(new SlugAtlasPage(this.#device, atlas, this.#pipelines));
      }
    } catch (error) {
      for (const page of pages) page.destroy();
      for (const atlas of atlases.slice(pages.length)) atlas.destroy();
      throw error;
    }

    const nextPageByGlyph = new Map(this.#pageByGlyph);
    const replaced = new Set<SlugAtlasPage>();
    for (const page of pages) {
      for (const glyphId of page.glyphKeys) {
        const previous = nextPageByGlyph.get(glyphId);
        if (previous) replaced.add(previous);
        nextPageByGlyph.set(glyphId, page);
      }
    }

    for (const page of pages) this.#pages.add(page);
    this.#pageByGlyph.clear();
    for (const [glyphId, page] of nextPageByGlyph) this.#pageByGlyph.set(glyphId, page);
    this.#removeUnusedPages(replaced);
  }

  invalidate(glyphIds: readonly CatalogGlyphKey[]): void {
    const affected = new Set<SlugAtlasPage>();
    for (const glyphId of glyphIds) {
      const page = this.#pageByGlyph.get(glyphId);
      if (page) affected.add(page);
      this.#pageByGlyph.delete(glyphId);
    }
    this.#removeUnusedPages(affected);
  }

  hasGlyphs(glyphIds: readonly CatalogGlyphKey[]): boolean {
    return glyphIds.every((glyphId) => this.#pageByGlyph.has(glyphId));
  }

  setResolvedWeights(updates: readonly GlyphAtlasPageWeights[]): void {
    const pagesByIndex = new Map([...this.#pages].map((page) => [page.pageIndex, page]));
    for (const update of updates) {
      const page = pagesByIndex.get(update.pageIndex);
      if (!page) throw new Error(`resident Slug page ${update.pageIndex} is missing`);
      page.atlas.setResolvedWeights(update.weights);
    }
  }

  draw(frame: GlyphPreviewFrame): void {
    if (this.#disposed) return;
    if (frame.instances.length === 0) {
      this.#clear();
      return;
    }

    const instancesByPage = new Map<SlugAtlasPage, GlyphPreviewInstance[]>();
    for (const instance of frame.instances) {
      const page = this.#pageByGlyph.get(instance.glyphId);
      if (!page) throw new Error(`resident Slug glyph ${instance.glyphId} is not loaded`);
      const instances = instancesByPage.get(page) ?? [];
      instances.push(instance);
      instancesByPage.set(page, instances);
    }

    const encoder = this.#device.createCommandEncoder({ label: "shift Slug frame" });
    const renderCounts = new Map<SlugAtlasPage, number>();
    for (const [page, instances] of instancesByPage) {
      const packed = page.atlas.frame(instances);
      if (packed.instanceCount === 0) continue;

      page.buffers.prepare(frame, packed);
      {
        const pass = encoder.beginComputePass({ label: "shift Slug resolve" });
        pass.setPipeline(this.#pipelines.resolve);
        setGroups(pass, page.buffers.resolveGroups);
        pass.dispatchWorkgroups(packed.instanceCount);
        pass.end();
      }
      page.buffers.copyPreviewBounds(encoder, packed.instanceCount);
      {
        const pass = encoder.beginComputePass({ label: "shift Slug bands" });
        pass.setPipeline(this.#pipelines.bands);
        setGroups(pass, page.buffers.bandGroups);
        pass.dispatchWorkgroups(packed.instanceCount * page.atlas.bandCount * 2);
        pass.end();
      }
      renderCounts.set(page, packed.instanceCount);
    }

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
    if (renderCounts.size > 0) {
      pass.setPipeline(this.#pipelines.render);
      for (const [page, instanceCount] of renderCounts) {
        setGroups(pass, page.buffers.renderGroups);
        pass.draw(6, instanceCount);
      }
    }
    pass.end();
    this.#device.queue.submit([encoder.finish({ label: "shift Slug frame" })]);
  }

  async complete(): Promise<void> {
    await this.#device.queue.onSubmittedWorkDone();
  }

  destroy(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#release();
  }

  #removeUnusedPages(candidates: ReadonlySet<SlugAtlasPage>): void {
    const used = new Set(this.#pageByGlyph.values());
    for (const page of candidates) {
      if (used.has(page)) continue;
      this.#pages.delete(page);
      page.destroy();
    }
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
    this.#device.queue.submit([encoder.finish({ label: "shift Slug clear" })]);
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
    for (const page of this.#pages) page.destroy();
    this.#pages.clear();
    this.#pageByGlyph.clear();
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
