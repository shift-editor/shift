import type { GlyphSidebearings } from "@shift/glyph-state";
import type { SideLink } from "@shift/wasm/protocol";
import type { MetricsLinks } from "../lib/model/MetricsLinks";
import { useMemo } from "react";
import type { Editor } from "../lib/editor/Editor";
import type { Glyph } from "../lib/model/Glyph";
import { computed, useSignalState } from "../lib/signals";

const EMPTY_SIDEBEARINGS: GlyphSidebearings = { lsb: null, rsb: null };

export interface GlyphMetricsState {
  readonly glyph: Glyph | null;
  readonly sidebearings: GlyphSidebearings;
  readonly xAdvance: number;
  /** Whether the displayed glyph has an authored layer at the active source or location. */
  readonly hasLayer: boolean;
  /** The glyph's linked sides at the active source; none between sources. */
  readonly linkedSides: readonly SideLink[];
  /** The glyph's metrics keys at the active source, to change; null between sources. */
  readonly links: MetricsLinks | null;
}

const EMPTY_METRICS: GlyphMetricsState = {
  glyph: null,
  sidebearings: EMPTY_SIDEBEARINGS,
  xAdvance: 0,
  hasLayer: false,
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

        const glyph = editor.glyphForId(node.glyphId);
        if (!glyph) return EMPTY_METRICS;

        const externalLocation = editor.externalLocationCell.value;
        const activeSourceId = editor.activeSourceIdCell.value;
        const renderModel = glyph.renderModelAt(
          editor.externalLocationCell,
          editor.activeSourceIdCell,
        );

        return {
          glyph,
          sidebearings: renderModel.sidebearingsCell.value,
          xAdvance: renderModel.xAdvanceCell.value,
          hasLayer: activeSourceId
            ? glyph.layerForSource(activeSourceId) !== null
            : glyph.layerAt(externalLocation) !== null,
          linkedSides: activeSourceId ? editor.font.linkedSides(glyph.id, activeSourceId) : [],
          links: editor.activeMetricsLinks(),
        };
      }),
    [editor],
  );

  return useSignalState(metricsCell, { schedule: "frame" });
}
