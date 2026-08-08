import type { Bounds } from "@shift/geo";
import type { SegmentedContour } from "@shift/glyph-state";
import type { AnchorData, AnchorId, ContourData, ContourId } from "@shift/types";
import type { LayerContourCoordinates } from "@/lib/model/GlyphLayerState";
import type { Signal } from "@/lib/signals";

/** Font metrics needed by glyph guide drawing. */
export interface GlyphGuideMetrics {
  readonly ascender: number;
  readonly descender: number;
  readonly capHeight?: number;
  readonly xHeight?: number;
}

/** Minimal outline surface shared by authored and retained glyph models. */
export interface GlyphOutline {
  readonly drawPath: Path2D;
}

/** Resolved selected-glyph input consumed synchronously by canvas drawing. */
export interface RenderGlyph extends GlyphOutline {
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
