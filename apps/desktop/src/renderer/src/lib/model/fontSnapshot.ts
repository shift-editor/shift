import type { FontSnapshot, GlyphEntry, GlyphRecord } from "@shift/types";
import type { WorkspaceSnapshot } from "@shared/workspace/protocol";

export function glyphEntry(record: GlyphRecord): GlyphEntry {
  return {
    id: record.id,
    name: record.name,
    unicodes: [...record.unicodes],
  };
}

export function fontSnapshotFromWorkspace(workspace: WorkspaceSnapshot): FontSnapshot {
  return {
    metadata: workspace.metadata,
    metrics: workspace.metrics,
    metricDefinitions: workspace.metricDefinitions,
    ...(workspace.sourceMetricsInterpolation
      ? { sourceMetricsInterpolation: workspace.sourceMetricsInterpolation }
      : {}),
    glyphs: workspace.glyphs.map(glyphEntry),
    sources: workspace.sources,
    axes: workspace.axes,
    axisMappings: workspace.axisMappings,
    namedInstances: workspace.namedInstances,
  };
}
