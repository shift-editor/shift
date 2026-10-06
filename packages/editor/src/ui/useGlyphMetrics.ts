import type { GlyphSidebearings } from "@shift/glyph-state";
import { useMemo } from "react";
import type { Editor } from "../lib/editor/Editor";
import type { Glyph } from "../lib/model/Glyph";
import { computed, useSignalState } from "../lib/signals";
import { sidebarGlyphs } from "./glyphTargets";

export interface GlyphMetricsState {
  /** The glyphs the sidebar shows and edits; see {@link sidebarGlyphs}. */
  readonly glyphs: readonly Glyph[];
  /** Each metric is null when the glyphs disagree on it, or a glyph has no outline. */
  readonly sidebearings: GlyphSidebearings;
  readonly xAdvance: number | null;
  /** Whether every glyph has an authored layer at the active source or location. */
  readonly hasLayer: boolean;
}

const EMPTY_METRICS: GlyphMetricsState = {
  glyphs: [],
  sidebearings: { lsb: null, rsb: null },
  xAdvance: null,
  hasLayer: false,
};

/**
 * Tracks live metrics for the glyphs the sidebar targets.
 *
 * @remarks
 * A metric shows a value only when every target glyph has the same one, so
 * editing it never hides a difference between glyphs.
 */
export function useGlyphMetrics(editor: Editor): GlyphMetricsState {
  const metricsCell = useMemo(
    () =>
      computed((): GlyphMetricsState => {
        const glyphs = sidebarGlyphs(editor);
        if (glyphs.length === 0) return EMPTY_METRICS;

        const externalLocation = editor.externalLocationCell.value;
        const activeSourceId = editor.activeSourceIdCell.value;
        const metrics = glyphs.map((glyph) => {
          const model = glyph.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell);
          return {
            sidebearings: model.sidebearingsCell.value,
            xAdvance: model.xAdvanceCell.value,
            hasLayer: activeSourceId
              ? glyph.layerForSource(activeSourceId) !== null
              : glyph.layerAt(externalLocation) !== null,
          };
        });

        return {
          glyphs,
          sidebearings: {
            lsb: shared(metrics.map((metric) => metric.sidebearings.lsb)),
            rsb: shared(metrics.map((metric) => metric.sidebearings.rsb)),
          },
          xAdvance: shared(metrics.map((metric) => metric.xAdvance)),
          hasLayer: metrics.every((metric) => metric.hasLayer),
        };
      }),
    [editor],
  );

  return useSignalState(metricsCell, { schedule: "frame" });
}

/** The value every entry shares, or null when they differ or any is null. */
function shared(values: readonly (number | null)[]): number | null {
  const [first] = values;
  if (first === undefined || first === null) return null;

  return values.every((value) => value === first) ? first : null;
}
