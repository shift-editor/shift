import type { SegmentedContour } from "@shift/glyph-state";
import type { AnchorData, AnchorId, ContourData, ContourId } from "@shift/types";
import type { LayerContourCoordinates } from "@/lib/model/GlyphLayerState";
import type { Signal } from "@/lib/signals";

/** Contour geometry and identity consumed by renderer output. */
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
