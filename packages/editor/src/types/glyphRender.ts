import type { Bounds, MatModel } from "@shift/geo";
import type { SegmentedContour } from "@shift/glyph-state";
import type { AnchorId, ContourId, SourceId } from "@shift/types";
import type { Signal } from "../lib/signals/signal";
import type { ExternalAxisLocation } from "./variation";

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

/** One master's share of an in-between location: the glyph's source weight. */
export interface WeightedSource {
  readonly sourceId: SourceId;
  readonly weight: number;
}

/** One master's outline of a component occurrence and that master's transform for it. */
export interface PlacedContours {
  readonly matrix: MatModel;
  readonly contours: readonly GlyphRenderContour[];
}

/**
 * Stable render-model inputs for one source.
 *
 * @remarks
 * `Glyph.renderModelAt` caches by cell identity, so callers that evaluate a
 * source repeatedly reuse these cells for as long as the source stays where it is.
 */
export interface SourceRenderInputs {
  readonly location: ExternalAxisLocation;
  readonly locationCell: Signal<ExternalAxisLocation>;
  readonly sourceIdCell: Signal<SourceId | null>;
}
