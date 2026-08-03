import type { Axis, SourceId } from "@shift/types";
import type { CatalogGlyphKey } from "./glyphAtlas";
import type { AxisLocation } from "./variation";

/** One visible glyph preview and its destination rectangle in physical pixels. */
export interface GlyphPreviewInstance {
  readonly glyphId: CatalogGlyphKey;
  readonly sourceId: SourceId | null;
  readonly pixelRect: readonly [number, number, number, number];
}

/** Screen-space styling shared by resident glyph preview backends. */
export interface GlyphPreviewStyle {
  readonly defaultPixelsPerEm: number;
  readonly metricsTop: number;
  readonly metricsBottom: number;
  readonly color: readonly [number, number, number, number];
}

/** Complete input for one resident glyph preview frame. */
export interface GlyphPreviewFrame {
  readonly location: AxisLocation;
  readonly axes: readonly Axis[];
  readonly instances: readonly GlyphPreviewInstance[];
  readonly style: GlyphPreviewStyle;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}

/** Required capacities for location-resolved, visible-only GPU scratch. */
export interface GlyphPreviewCapacity {
  readonly curveCount: number;
  readonly bandCount: number;
  readonly indexCount: number;
  readonly glyphCount: number;
  readonly componentTransformCount: number;
}

/** Packed instance bytes and capacities derived for one preview frame. */
export interface PackedGlyphPreviewFrame {
  readonly instances: Uint8Array<ArrayBuffer>;
  readonly capacity: GlyphPreviewCapacity;
  readonly instanceCount: number;
}
