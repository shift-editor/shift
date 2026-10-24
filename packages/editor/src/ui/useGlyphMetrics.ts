import type { GlyphSidebearings } from "@shift/glyph-state";
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
}

const EMPTY_METRICS: GlyphMetricsState = {
  glyph: null,
  sidebearings: EMPTY_SIDEBEARINGS,
  xAdvance: 0,
  hasLayer: false,
};

/**
 * Tracks live metrics for the glyph the session shows, `editing.subject("glyph")`.
 *
 * @remarks
 * Keeps reading while editing is suspended (Hand, Text), like the editor's
 * metric setters, which write through the same reader. Returns empty metrics
 * when no single glyph qualifies, so metric edits never target an ambiguous
 * occurrence.
 */
export function useGlyphMetrics(editor: Editor): GlyphMetricsState {
  const metricsCell = useMemo(
    () =>
      computed((): GlyphMetricsState => {
        const subject = editor.editing.subjectCell("glyph").value;
        if (!subject) return EMPTY_METRICS;

        const { glyph } = subject;

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
        };
      }),
    [editor],
  );

  return useSignalState(metricsCell, { schedule: "frame" });
}
