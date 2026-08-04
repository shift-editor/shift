import type { Bounds, Point2D } from "@shift/geo";
import type { SegmentedContour } from "@shift/glyph-state";
import type { AnchorData, AnchorId, ContourData, ContourId, PointType } from "@shift/types";
import type { LayerContourCoordinates } from "@/lib/model/GlyphLayerState";
import type { Signal } from "@/lib/signals";

/** Source-independent point geometry consumed by glyph drawing. */
export interface GlyphRenderPoint extends Point2D {
  readonly pointType: PointType;
  readonly smooth: boolean;
}

/** Source-independent contour geometry consumed by controls drawing. */
export interface GlyphRenderContourShape {
  readonly points: readonly GlyphRenderPoint[];
  readonly closed: boolean;
}

/** One resolved contour occurrence in root-glyph coordinates. */
export interface GlyphRenderContourOccurrence {
  readonly contour: GlyphRenderContourShape;
  readonly root: boolean;
  readonly path: Path2D;
  readonly svgPath: string;
  readonly bounds: Bounds | null;
}

/** Font metrics needed by glyph guide drawing. */
export interface GlyphGuideMetrics {
  readonly ascender: number;
  readonly descender: number;
  readonly capHeight?: number;
  readonly xHeight?: number;
}

/** Source-independent anchor geometry consumed by passive drawing. */
export interface GlyphRenderAnchorShape extends Point2D {
  readonly name?: string;
}

/** Minimal outline surface shared by authored and retained glyph models. */
export interface GlyphOutline {
  readonly drawPath: Path2D;
}

/** Resolved selected-glyph input consumed synchronously by canvas drawing. */
export interface GlyphRenderInput extends GlyphOutline {
  readonly contours: readonly GlyphRenderContourOccurrence[];
  readonly anchors: readonly GlyphRenderAnchorShape[];
  readonly drawPath: Path2D;
  readonly bounds: Bounds | null;
  readonly xAdvance: number;
}

/** Contour geometry and authored identity consumed by editor output. */
export interface GlyphRenderContour extends SegmentedContour {
  readonly id: ContourId;
}

/** Anchor identity and position consumed by renderer output. */
export interface GlyphRenderAnchor {
  readonly id: AnchorId;
  readonly name?: string;
  readonly x: number;
  readonly y: number;
}

/** Authored contour structure paired with its live coordinate buffer. */
export interface GlyphRenderContourInput {
  readonly data: ContourData;
  readonly coordinates: LayerContourCoordinates;
}

/** Authored anchor structure paired with its live coordinate buffer offset. */
export interface GlyphRenderAnchorInput {
  readonly data: AnchorData;
  readonly values: Signal<Float64Array>;
  readonly offset: number;
}
