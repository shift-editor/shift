import type {
  AnchorId,
  Axis,
  AxisMappingBasis,
  ContourId,
  GlyphEntry,
  GlyphId,
  GlyphPreview,
  GlyphProjection,
  GlyphSnapshot,
  PointId,
  Source,
  SourceId,
} from "@shift/types";
import type { SegmentId } from "@shift/glyph-state";
import type { Glyph, GlyphLayer } from "@/lib/model/Glyph";
import type { Signal } from "@/lib/signals/signal";
import type { DesignAxisLocation } from "./variation";

/** Acquires glyph projections and lightweight previews from the session boundary. */
export interface GlyphReader {
  read(glyphIds: readonly GlyphId[]): Promise<readonly GlyphSnapshot[]>;
  glyphPreviews(
    glyphIds: readonly GlyphId[],
    location: DesignAxisLocation,
  ): Promise<readonly GlyphPreview[]>;
}

export interface GlyphGeometrySelection {
  readonly points?: Iterable<PointId>;
  readonly anchors?: Iterable<AnchorId>;
  readonly contours?: Iterable<ContourId>;
  readonly segments?: Iterable<SegmentId>;
}

export interface GlyphOptions {
  readonly entry: GlyphEntry;
  readonly layers: readonly GlyphLayer[];
  readonly componentGlyphs: ReadonlyMap<GlyphId, Glyph>;
  readonly axesCell: Signal<Axis[]>;
  readonly axisMappingBasesCell: Signal<AxisMappingBasis[]>;
  readonly sourcesCell: Signal<Source[]>;
  readonly projectionCell: Signal<GlyphProjection | null>;
  readonly defaultSourceId: SourceId;
}
