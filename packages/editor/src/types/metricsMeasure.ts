import type { GlyphSidebearings } from "@shift/glyph-state";
import type { LayerExtent, LayerExtentFallback } from "@shift/wasm/protocol";

/** Sidebearings the inspector and tools show, with skeleton values when they differ. */
export interface GlyphMetricsSidebearings extends GlyphSidebearings {
  readonly skeletonLsb: number | null;
  readonly skeletonRsb: number | null;
  readonly fallbackTooltip: string | null;
}

/** Turns Rust's layer extent into sidebearings for one advance. */
export function sidebearingsFromLayerExtent(
  extent: LayerExtent,
  advance: number,
): GlyphMetricsSidebearings {
  const lsb = extent.minX;
  const rsb = advance - extent.maxX;
  const skeletonLsb = extent.skeleton.minX;
  const skeletonRsb = advance - extent.skeleton.maxX;
  const measuresDiffer =
    extent.ink !== null &&
    (Math.abs(skeletonLsb - lsb) > 1e-6 || Math.abs(skeletonRsb - rsb) > 1e-6);

  return {
    lsb,
    rsb,
    skeletonLsb: measuresDiffer ? skeletonLsb : null,
    skeletonRsb: measuresDiffer ? skeletonRsb : null,
    fallbackTooltip: fallbackTooltip(extent.fallback ?? null),
  };
}

function fallbackTooltip(fallback: LayerExtentFallback | null): string | null {
  if (!fallback) return null;

  switch (fallback.kind) {
    case "strokeCouldNotBeSolved":
      return `Stroke could not be solved: ${fallback.message}`;
    case "ignoreStroke":
      return "Include stroke is off; showing the skeleton.";
    case "betweenMasters":
      return "Between masters; showing the skeleton.";
  }
}
