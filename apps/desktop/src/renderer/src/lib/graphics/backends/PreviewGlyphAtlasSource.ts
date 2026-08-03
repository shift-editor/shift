import { asGlyphIndex } from "@shift/types";
import type { FontSessionClient } from "@/lib/workspace/FontSessionClient";
import type {
  CatalogGlyphKey,
  GlyphAtlasPageDescriptor,
  GlyphAtlasPageRequest,
  GlyphAtlasPageWeights,
  GlyphAtlasSource,
} from "@/types/glyphAtlas";

/** Adapts retained source pages to the backend-neutral resident contract. */
export class PreviewGlyphAtlasSource implements GlyphAtlasSource {
  readonly #client: FontSessionClient;

  constructor(client: FontSessionClient) {
    this.#client = client;
  }

  async preparePage(
    request: GlyphAtlasPageRequest,
    alignment: number,
  ): Promise<GlyphAtlasPageDescriptor> {
    const descriptor = await this.#client.prepareSourceAtlasPage({
      pageIndex: request.pageIndex,
      glyphIndices: request.glyphKeys.map(previewGlyphIndex),
      coordinates: [...request.coordinates],
      alignment,
    });

    return {
      generation: descriptor.generation,
      pageIndex: descriptor.pageIndex,
      bandCount: descriptor.bandCount,
      weightCount: descriptor.weightCount,
      layout: descriptor.layout,
      previewExtents: descriptor.previewExtents,
      glyphs: descriptor.glyphs.map((glyph) => ({
        glyphKey: asGlyphIndex(glyph.glyphIndex),
        defaultGlyph: glyph.atlasGlyph,
        exactSources: [],
      })),
      weightSets: [],
      weightAxes: [],
      resolvedWeights: descriptor.weights,
    };
  }

  async streamPage(
    descriptor: GlyphAtlasPageDescriptor,
    maximumLength: number,
    write: (offset: number, bytes: Uint8Array<ArrayBuffer>) => void,
  ): Promise<number> {
    return this.#client.streamSourceAtlasPage(descriptor.generation, maximumLength, write);
  }

  async discardPage(descriptor: GlyphAtlasPageDescriptor): Promise<void> {
    await this.#client.discardSourceAtlasPage(descriptor.pageIndex, descriptor.generation);
  }

  async weights(coordinates: readonly number[]): Promise<readonly GlyphAtlasPageWeights[]> {
    return this.#client.sourceAtlasWeights(coordinates);
  }
}

function previewGlyphIndex(key: CatalogGlyphKey): number {
  if (typeof key !== "number") throw new Error("preview atlas received an authored glyph id");
  return key;
}
