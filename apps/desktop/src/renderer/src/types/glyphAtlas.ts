import type {
  GlyphId,
  SlugLayout,
  Axis,
  SlugExactSource,
  SlugPreviewExtents,
  SlugWeightSet,
} from "@shift/types";

export interface GlyphAtlasGlyph {
  readonly glyphId: GlyphId;
  readonly defaultGlyph: number;
  readonly exactSources: readonly SlugExactSource[];
}

/** Backend-neutral metadata for one prepared resident page. */
export interface GlyphAtlasPage {
  readonly generation: number;
  readonly pageIndex: number;
  readonly bandCount: number;
  readonly weightCount: number;
  readonly layout: SlugLayout;
  readonly previewExtents: SlugPreviewExtents;
  readonly glyphs: readonly GlyphAtlasGlyph[];
  readonly weightSets: readonly SlugWeightSet[];
  readonly weightAxes: readonly Axis[];
  readonly resolvedWeights: readonly number[] | null;
}

export interface GlyphAtlasPageRequest {
  readonly glyphIds: readonly GlyphId[];
  readonly pageIndex: number;
  readonly pageCount: number;
  readonly replacementPageIndices: readonly number[];
  readonly coordinates: readonly number[];
}

export interface GlyphAtlasPageWeights {
  readonly pageIndex: number;
  readonly weights: readonly number[];
}

/** Format-independent page producer consumed by the shared resident Grid. */
export interface GlyphAtlasSource {
  preparePage(request: GlyphAtlasPageRequest, alignment: number): Promise<GlyphAtlasPage>;
  streamPage(
    descriptor: GlyphAtlasPage,
    maximumLength: number,
    write: (offset: number, bytes: Uint8Array<ArrayBuffer>) => void,
  ): Promise<number>;
  discardPage(descriptor: GlyphAtlasPage): Promise<void>;
  weights(coordinates: readonly number[]): Promise<readonly GlyphAtlasPageWeights[]>;
}
