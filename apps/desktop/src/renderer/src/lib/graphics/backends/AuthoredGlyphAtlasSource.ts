import type { Axis, AxisMappingBasis } from "@shift/types";
import type { SlugAtlasOrigin } from "@shared/workspace/protocol";
import type { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";
import type {
  GlyphAtlasPage,
  GlyphAtlasPageRequest,
  GlyphAtlasPageWeights,
  GlyphAtlasSource,
} from "@/types/glyphAtlas";

/** Adapts authored workspace pages to the backend-neutral resident contract. */
export class AuthoredGlyphAtlasSource implements GlyphAtlasSource {
  readonly #edits: WorkspaceEditCoordinator;
  readonly #axes: () => readonly Axis[];
  readonly #mappingBases: () => readonly AxisMappingBasis[];
  readonly #origins = new Map<number, SlugAtlasOrigin>();

  constructor(
    edits: WorkspaceEditCoordinator,
    axes: () => readonly Axis[],
    mappingBases: () => readonly AxisMappingBasis[],
  ) {
    this.#edits = edits;
    this.#axes = axes;
    this.#mappingBases = mappingBases;
  }

  async preparePage(request: GlyphAtlasPageRequest, alignment: number): Promise<GlyphAtlasPage> {
    const glyphIds = [...request.glyphIds];
    const descriptor = await this.#edits.prepareSlugAtlasPage({
      glyphIds,
      alignment,
      pageIndex: request.pageIndex,
      pageCount: request.pageCount,
      replacementPageIndices: [...request.replacementPageIndices],
    });
    this.#origins.set(descriptor.generation, descriptor.origin);

    return {
      generation: descriptor.generation,
      pageIndex: request.pageIndex,
      bandCount: descriptor.bandCount,
      weightCount: descriptor.weightCount,
      layout: descriptor.layout,
      previewExtents: descriptor.previewExtents,
      glyphs: descriptor.glyphs.map((glyph) => ({
        glyphId: glyph.glyphId,
        defaultGlyph: glyph.defaultGlyph,
        exactSources: glyph.exactSources,
      })),
      weightSets: descriptor.weightSets,
      weightAxes: [...this.#axes()],
      weightMappingBases: [...this.#mappingBases()],
      resolvedWeights: null,
    };
  }

  async streamPage(
    descriptor: GlyphAtlasPage,
    maximumLength: number,
    write: (offset: number, bytes: Uint8Array<ArrayBuffer>) => void,
  ): Promise<number> {
    const origin = this.#requireOrigin(descriptor.generation);
    try {
      return await this.#edits.streamSlugAtlasPage(
        descriptor.generation,
        origin,
        maximumLength,
        write,
      );
    } finally {
      this.#origins.delete(descriptor.generation);
    }
  }

  async discardPage(descriptor: GlyphAtlasPage): Promise<void> {
    const origin = this.#origins.get(descriptor.generation);
    this.#origins.delete(descriptor.generation);
    if (!origin) return;

    await this.#edits.discardSlugAtlasPage(descriptor.generation, origin);
  }

  async weights(_coordinates: readonly number[]): Promise<readonly GlyphAtlasPageWeights[]> {
    return [];
  }

  #requireOrigin(generation: number): SlugAtlasOrigin {
    const origin = this.#origins.get(generation);
    if (!origin) throw new Error(`unknown authored atlas generation ${generation}`);
    return origin;
  }
}
