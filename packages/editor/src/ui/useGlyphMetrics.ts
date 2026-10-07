import { useMemo } from "react";
import type { Editor } from "../lib/editor/Editor";
import { computed, useSignalState } from "../lib/signals";
import type { GlyphMetricsTarget, GlyphMetricValues } from "../types/inspector";

export interface GlyphMetricsView {
  /** The inspector's glyph metrics target, or null when the subject has none. */
  readonly target: GlyphMetricsTarget | null;
  readonly values: GlyphMetricValues;
}

const NO_METRICS: GlyphMetricsView = {
  target: null,
  values: { lsb: null, rsb: null, xAdvance: null, editable: false, sidebearingsEditable: false },
};

/** Tracks the glyph metrics section the inspector shows for the current subject. */
export function useGlyphMetrics(editor: Editor): GlyphMetricsView {
  const viewCell = useMemo(
    () =>
      computed((): GlyphMetricsView => {
        const section = editor.inspect().find((candidate) => candidate.kind === "glyphMetrics");
        if (!section) return NO_METRICS;

        return { target: section.metrics, values: section.metrics.values() };
      }),
    [editor],
  );

  return useSignalState(viewCell, { schedule: "frame" });
}
