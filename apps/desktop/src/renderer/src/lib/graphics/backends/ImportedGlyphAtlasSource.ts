import type { GlyphId } from "@shift/types";
import type { FontSessionClient } from "@/lib/workspace/FontSessionClient";
import type {
  GlyphAtlasPage,
  GlyphAtlasPageRequest,
  GlyphAtlasPageWeights,
  GlyphAtlasSource,
} from "@/types/glyphAtlas";

/** Adapts immutable imported-source pages to the resident atlas contract. */
export class ImportedGlyphAtlasSource implements GlyphAtlasSource {
  readonly #client: FontSessionClient;

  constructor(client: FontSessionClient) {
    this.#client = client;
  }

  async preparePage(request: GlyphAtlasPageRequest, alignment: number): Promise<GlyphAtlasPage> {
    const descriptor = await this.#client.prepareSourceAtlasPage({
      pageIndex: request.pageIndex,
      glyphIds: [...request.glyphIds],
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
        glyphId: glyph.glyphId as GlyphId,
        defaultGlyph: glyph.defaultGlyph,
        exactSources: glyph.exactSources,
      })),
      weightSets: [],
      weightAxes: [],
      weightMappingBases: [],
      resolvedWeights: descriptor.weights,
    };
  }

  async streamPage(
    descriptor: GlyphAtlasPage,
    maximumLength: number,
    write: (offset: number, bytes: Uint8Array<ArrayBuffer>) => void,
  ): Promise<number> {
    return this.#client.streamSourceAtlasPage(descriptor.generation, maximumLength, write);
  }

  async discardPage(descriptor: GlyphAtlasPage): Promise<void> {
    await this.#client.discardSourceAtlasPage(descriptor.pageIndex, descriptor.generation);
  }

  async weights(coordinates: readonly number[]): Promise<readonly GlyphAtlasPageWeights[]> {
    return this.#client.sourceAtlasWeights(coordinates);
  }
}
