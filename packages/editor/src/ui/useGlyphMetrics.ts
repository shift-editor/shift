import { useMemo } from "react";
import type { Editor } from "../lib/editor/Editor";
import type { Glyph } from "../lib/model/Glyph";
import { computed, useSignalState } from "../lib/signals";

/** A metric the subject glyphs share, `"mixed"` when they differ, or null when none has it. */
export type SharedMetric = number | null | "mixed";

export interface GlyphMetricsState {
  /** The glyphs the sidebar describes; see `Editor.subjectGlyphNodesCell`. */
  readonly glyphs: readonly Glyph[];
  readonly lsb: SharedMetric;
  readonly rsb: SharedMetric;
  readonly xAdvance: SharedMetric;
  /** Whether every glyph has an authored layer at the active source or location. */
  readonly hasLayer: boolean;
}

const EMPTY_METRICS: GlyphMetricsState = {
  glyphs: [],
  lsb: null,
  rsb: null,
  xAdvance: null,
  hasLayer: false,
};

/**
 * Tracks live metrics for the glyphs the sidebar describes.
 *
 * @remarks
 * With several glyphs, each metric is their shared value, rounded, or
 * `"mixed"` when they differ, as a design tool shows a multi-selection.
 */
export function useGlyphMetrics(editor: Editor): GlyphMetricsState {
  const metricsCell = useMemo(
    () =>
      computed((): GlyphMetricsState => {
        // Two nodes can show the same glyph; describe it once.
        const glyphs = [
          ...new Set(
            editor.subjectGlyphNodesCell.value.flatMap((node) => editor.glyphOf(node) ?? []),
          ),
        ];
        if (glyphs.length === 0) return EMPTY_METRICS;

        const externalLocation = editor.externalLocationCell.value;
        const activeSourceId = editor.activeSourceIdCell.value;
        const models = glyphs.map((glyph) =>
          glyph.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell),
        );
        const sidebearings = models.map((model) => model.sidebearingsCell.value);

        return {
          glyphs,
          lsb: shared(sidebearings.map(({ lsb }) => lsb)),
          rsb: shared(sidebearings.map(({ rsb }) => rsb)),
          xAdvance: shared(models.map((model) => model.xAdvanceCell.value)),
          hasLayer: glyphs.every((glyph) =>
            activeSourceId
              ? glyph.layerForSource(activeSourceId) !== null
              : glyph.layerAt(externalLocation) !== null,
          ),
        };
      }),
    [editor],
  );

  return useSignalState(metricsCell, { schedule: "frame" });
}

/** The values' rounded common value, `"mixed"` when they differ, or null when any is missing. */
function shared(values: readonly (number | null)[]): SharedMetric {
  if (values.some((value) => value === null)) return null;
  const rounded = values.map((value) => Math.round(value!));
  return rounded.every((value) => value === rounded[0]) ? rounded[0]! : "mixed";
}
