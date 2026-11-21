import type { GlyphMetricsSidebearings } from "../types/metricsMeasure";
import type { SideLink } from "@shift/wasm/protocol";
import type { MetricsLinks } from "../lib/model/MetricsLinks";
import { useMemo } from "react";
import type { Editor } from "../lib/editor/Editor";
import type { Glyph } from "../lib/model/Glyph";
import { computed, useSignalState } from "../lib/signals";

const EMPTY_METRICS_SIDEBEARINGS: GlyphMetricsSidebearings = {
  lsb: null,
  rsb: null,
  skeletonLsb: null,
  skeletonRsb: null,
  fallbackTooltip: null,
};

export interface GlyphMetricsState {
  readonly glyph: Glyph | null;
  readonly sidebearings: GlyphMetricsSidebearings;
  readonly xAdvance: number;
  /** Whether the displayed glyph has an authored layer at the active source or location. */
  readonly hasLayer: boolean;
  /** Whether metrics include stroke ink for this font. */
  readonly includeStroke: boolean;
  /** Whether the open glyph has a dynamic stroke in any drawing. */
  readonly hasDynamicStroke: boolean;
  readonly skeletonLsb: number | null;
  readonly skeletonRsb: number | null;
  readonly fallbackTooltip: string | null;
  /** The glyph's linked sides at the active source; none between sources. */
  readonly linkedSides: readonly SideLink[];
  /** The glyph's metrics keys at the active source, to change; null between sources. */
  readonly links: MetricsLinks | null;
}

const EMPTY_METRICS: GlyphMetricsState = {
  glyph: null,
  sidebearings: EMPTY_METRICS_SIDEBEARINGS,
  xAdvance: 0,
  hasLayer: false,
  includeStroke: true,
  hasDynamicStroke: false,
  skeletonLsb: null,
  skeletonRsb: null,
  fallbackTooltip: null,
  linkedSides: [],
  links: null,
};

/**
 * Tracks live metrics for the single glyph placed in the scene.
 *
 * Returns empty metrics when the scene holds zero or several glyph nodes, so
 * metric edits never target an ambiguous occurrence.
 */
export function useGlyphMetrics(editor: Editor): GlyphMetricsState {
  const metricsCell = useMemo(
    () =>
      computed((): GlyphMetricsState => {
        const node = editor.scene.onlyCell("glyph").value;
        if (!node) return EMPTY_METRICS;

        const glyph = editor.glyphForId(editor.drawnGlyphId(node));
        if (!glyph) return EMPTY_METRICS;

        const editLocation = editor.editLocationCell.value;
        const activeSourceId = editor.activeSourceIdCell.value;
        const renderModel = glyph.renderModelAt(editor.editLocationCell, editor.activeSourceIdCell);
        const metricsSidebearings = renderModel.sidebearingsCell.value;
        const layer =
          activeSourceId !== null
            ? glyph.layerForSource(activeSourceId)
            : glyph.layerAt(editLocation);
        const hasDynamicStroke =
          layer !== null && editor.font.liveStrokeContours(layer.id).length > 0;

        return {
          glyph,
          sidebearings: metricsSidebearings,
          xAdvance: renderModel.xAdvanceCell.value,
          hasLayer: layer !== null,
          includeStroke: editor.font.includeStrokeInMetricsCell.value,
          hasDynamicStroke,
          skeletonLsb: metricsSidebearings.skeletonLsb,
          skeletonRsb: metricsSidebearings.skeletonRsb,
          fallbackTooltip: metricsSidebearings.fallbackTooltip,
          linkedSides: activeSourceId ? editor.font.linkedSides(glyph.id, activeSourceId) : [],
          links: editor.activeMetricsLinks(),
        };
      }),
    [editor],
  );

  return useSignalState(metricsCell, { schedule: "frame" });
}
