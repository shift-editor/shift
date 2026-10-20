import type {
  AnchorId,
  ComponentId,
  ContourId,
  GlyphEntry,
  GlyphId,
  GlyphPreview,
  GlyphProjection,
  GlyphSnapshot,
  LayerId,
  PointId,
  SegmentId,
  SourceId,
  ReadonlyEntityMap,
} from "@shift/types";
import type { Designspace } from "../lib/variation/Designspace";
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
  readonly layerIdByPointId: ReadonlyEntityMap<PointId, LayerId>;
  readonly contourIdByPointId: ReadonlyEntityMap<PointId, ContourId>;
  readonly layerIdByContourId: ReadonlyEntityMap<ContourId, LayerId>;
  readonly layerIdByAnchorId: ReadonlyEntityMap<AnchorId, LayerId>;
  readonly layerIdBySegmentId: ReadonlyEntityMap<SegmentId, LayerId>;
  readonly contourIdBySegmentId: ReadonlyEntityMap<SegmentId, ContourId>;
  readonly pointIdsBySegmentId: ReadonlyEntityMap<SegmentId, readonly PointId[]>;
}

export interface GlyphGeometrySelection {
  readonly points?: Iterable<PointId>;
  readonly anchors?: Iterable<AnchorId>;
  readonly contours?: Iterable<ContourId>;
  readonly segments?: Iterable<SegmentId>;
}

/** What anchor propagation reads from a glyph's category, as export resolves it. */
export interface AnchorPropagationCategory {
  /** In the Mark category or classed `mark`: a mark with anchors keeps its own. */
  readonly mark: boolean;
  /** `"explicit"` when classed a ligature; `"subcategory"` when a ligature once it has an attaching anchor. */
  readonly ligature: "explicit" | "subcategory" | null;
}

export interface GlyphOptions {
  readonly entry: GlyphEntry;
  readonly layers: readonly GlyphLayer[];
  readonly componentGlyphs: ReadonlyMap<GlyphId, Glyph>;
  readonly designspace: Designspace;
  readonly projectionCell: Signal<GlyphProjection | null>;
  readonly defaultSourceId: SourceId;
  /** Reads a glyph's propagation category; reactive callers re-run when it changes. */
  readonly anchorCategory: (glyphId: GlyphId) => AnchorPropagationCategory;
}
