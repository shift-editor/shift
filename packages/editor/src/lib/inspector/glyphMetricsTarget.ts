import type { Editor } from "../editor/Editor";
import type { Glyph } from "../model/Glyph";
import { track } from "../signals";
import type { GlyphMetric, GlyphMetricsTarget, GlyphMetricValues } from "../../types/inspector";

const METRIC_LABELS: Record<GlyphMetric, string> = {
  advance: "Set advance width",
  left: "Set left sidebearing",
  right: "Set right sidebearing",
};

/**
 * Builds the metrics target for a set of glyphs.
 *
 * @remarks
 * Values come from each glyph's render model at the current source or
 * location, so they follow drags and source switches. A value shows only when
 * every glyph agrees. Writes go to each glyph's layer at the active source in
 * one transaction; glyphs without a layer there are left alone.
 */
export function glyphMetricsTarget(editor: Editor, glyphs: readonly Glyph[]): GlyphMetricsTarget {
  return {
    glyphs,
    values: () => metricValues(editor, glyphs),
    set: (metric, value) => setMetric(editor, glyphs, metric, value),
  };
}

function metricValues(editor: Editor, glyphs: readonly Glyph[]): GlyphMetricValues {
  track(editor.externalLocationCell);
  track(editor.activeSourceIdCell);
  const externalLocation = editor.externalLocationCell.peek();
  const activeSourceId = editor.activeSourceIdCell.peek();

  const metrics = glyphs.map((glyph) => {
    const model = glyph.renderModelAt(editor.externalLocationCell, editor.activeSourceIdCell);
    track(model.sidebearingsCell);
    track(model.xAdvanceCell);
    const hasLayer = activeSourceId
      ? glyph.layerForSource(activeSourceId) !== null
      : glyph.layerAt(externalLocation) !== null;
    return { ...model.sidebearingsCell.peek(), xAdvance: model.xAdvanceCell.peek(), hasLayer };
  });

  const lsb = shared(metrics.map((metric) => metric.lsb));
  const rsb = shared(metrics.map((metric) => metric.rsb));
  const editable =
    editor.sessionMode === "workspace" &&
    metrics.length > 0 &&
    metrics.every((metric) => metric.hasLayer);
  const outlined = metrics.every((metric) => metric.lsb !== null && metric.rsb !== null);

  return {
    lsb,
    rsb,
    xAdvance: shared(metrics.map((metric) => metric.xAdvance)),
    editable,
    sidebearingsEditable: editable && outlined,
  };
}

function setMetric(
  editor: Editor,
  glyphs: readonly Glyph[],
  metric: GlyphMetric,
  value: number,
): void {
  const sourceId = editor.activeSourceId;
  if (!sourceId) return;

  const layers = glyphs.flatMap((glyph) => glyph.layerForSource(sourceId) ?? []);
  if (layers.length === 0) return;

  editor.transaction(METRIC_LABELS[metric], () => {
    for (const layer of layers) {
      switch (metric) {
        case "advance":
          layer.setXAdvance(value);
          break;
        case "left":
          layer.setLeftSidebearing(value);
          break;
        case "right":
          layer.setRightSidebearing(value);
          break;
      }
    }
  });
}

/** The value every entry shares, or null when they differ or any is null. */
function shared(values: readonly (number | null)[]): number | null {
  const [first] = values;
  if (first === undefined || first === null) return null;

  return values.every((value) => value === first) ? first : null;
}
