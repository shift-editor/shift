import type {
  GlyphId,
  GlyphIndex,
  SlugLayout,
  SlugPreviewExtents,
  SlugWeightSet,
  SourceId,
} from "@shift/types";

/** Opaque catalog address; retained indexes never become authored IDs. */
export type CatalogGlyphKey = GlyphId | GlyphIndex;

export interface GlyphAtlasExactSource {
  readonly sourceId: SourceId;
  readonly glyphIndex: number;
}

export interface GlyphAtlasGlyph {
  readonly glyphKey: CatalogGlyphKey;
  readonly defaultGlyph: number;
  readonly exactSources: readonly GlyphAtlasExactSource[];
}

/** Backend-neutral metadata for one prepared resident page. */
export interface GlyphAtlasPageDescriptor {
  readonly generation: number;
  readonly pageIndex: number;
  readonly bandCount: number;
  readonly weightCount: number;
  readonly layout: SlugLayout;
  readonly previewExtents: SlugPreviewExtents;
  readonly glyphs: readonly GlyphAtlasGlyph[];
  readonly weightSets: readonly SlugWeightSet[];
  readonly resolvedWeights: readonly number[] | null;
}

export interface GlyphAtlasPageRequest {
  readonly glyphKeys: readonly CatalogGlyphKey[];
  readonly pageIndex: number;
  readonly pageCount: number;
  readonly replacementPageIndices: readonly number[];
  readonly coordinates: readonly number[] | null;
}

export interface GlyphAtlasPageWeights {
  readonly pageIndex: number;
  readonly weights: readonly number[];
}

/** Format-independent page producer consumed by the shared resident Grid. */
export interface GlyphAtlasSource {
  preparePage(request: GlyphAtlasPageRequest, alignment: number): Promise<GlyphAtlasPageDescriptor>;
  streamPage(
    descriptor: GlyphAtlasPageDescriptor,
    maximumLength: number,
    write: (offset: number, bytes: Uint8Array<ArrayBuffer>) => void,
  ): Promise<number>;
  discardPage(descriptor: GlyphAtlasPageDescriptor): Promise<void>;
  weights(coordinates: readonly number[]): Promise<readonly GlyphAtlasPageWeights[]>;
}
