import type { GlyphId } from "@shift/types";
import { SlugAtlas } from "./SlugAtlas";
import { SlugRendererBuffers, SlugRendererPipelines } from "./SlugRendererResources";

/** One independently compiled and replaceable root-glyph batch. */
export class SlugAtlasPage {
  readonly atlas: SlugAtlas;
  readonly buffers: SlugRendererBuffers;

  constructor(device: GPUDevice, atlas: SlugAtlas, pipelines: SlugRendererPipelines) {
    this.atlas = atlas;
    this.buffers = new SlugRendererBuffers(device, atlas, pipelines);
  }

  get glyphIds(): readonly GlyphId[] {
    return this.atlas.glyphIds;
  }

  destroy(): void {
    this.buffers.destroy();
    this.atlas.destroy();
  }
}
