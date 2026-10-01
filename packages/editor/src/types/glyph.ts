import type {
  AnchorId,
  Axis,
  AxisMappingBasis,
  ComponentId,
  ContourId,
  GlyphEntry,
  GlyphId,
  GlyphPreview,
  GlyphProjection,
  GlyphSnapshot,
  LayerId,
  PointId,
  Source,
  SourceId,
} from "@shift/types";
import type { SegmentId } from "@shift/glyph-state";
import type { Glyph, GlyphLayer } from "../lib/model/Glyph";
import type { Signal } from "../lib/signals/signal";
import type { DesignAxisLocation } from "./variation";

/** Determines whether on-curve deletion reconnects surviving endpoints or leaves a gap. */
export type DeleteMode = "fit" | "gap";

/** Identifies one filled glyph occurrence hit in front-to-back paint order. */
export type GlyphFillHit =
  | { readonly kind: "root" }
  | { readonly kind: "component"; readonly componentPath: readonly ComponentId[] };

/** Acquires glyph projections and lightweight previews from the session boundary. */
export interface GlyphReader {
  read(glyphIds: readonly GlyphId[]): Promise<readonly GlyphSnapshot[]>;
  glyphPreviews(
    glyphIds: readonly GlyphId[],
    location: DesignAxisLocation,
  ): Promise<readonly GlyphPreview[]>;
}

export interface GlyphObjectSegment {
  readonly id: SegmentId;
  readonly pointIds: readonly PointId[];
}

export interface GlyphObjectIndex {
  readonly layerIdByPointId: ReadonlyMap<PointId, LayerId>;
  readonly contourIdByPointId: ReadonlyMap<PointId, ContourId>;
  readonly layerIdByContourId: ReadonlyMap<ContourId, LayerId>;
  readonly layerIdByAnchorId: ReadonlyMap<AnchorId, LayerId>;
  readonly layerIdBySegmentId: ReadonlyMap<SegmentId, LayerId>;
  readonly contourIdBySegmentId: ReadonlyMap<SegmentId, ContourId>;
  readonly pointIdsBySegmentId: ReadonlyMap<SegmentId, readonly PointId[]>;
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
