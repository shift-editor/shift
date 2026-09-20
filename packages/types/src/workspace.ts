import type {
  Axis,
  AxisMapping,
  AxisMappingBasis,
  FontMetadata,
  FontMetrics,
  GlyphRecord,
  GlyphState,
  MetricDefinition,
  NamedInstance,
  Source,
  SourceMetricsInterpolationSnapshot,
} from "./bridge";
import type { GlyphId, SourceId } from "./ids";

/** Point-in-time view of an open workspace: identity and records, no geometry. */
export interface WorkspaceSnapshot {
  workspaceId: string;
  metadata: FontMetadata;
  metrics: FontMetrics;
  metricDefinitions: MetricDefinition[];
  sourceMetricsInterpolation: SourceMetricsInterpolationSnapshot | null;
  glyphs: GlyphRecord[];
  sources: Source[];
  axes: Axis[];
  axisMappings: AxisMapping[];
  axisMappingBases: AxisMappingBasis[];
  namedInstances: NamedInstance[];
}

export interface WorkspaceGlyphLayerSnapshot {
  glyphId: GlyphId;
  sourceId: SourceId;
  state: GlyphState;
}

/** Immutable product mode for one live font session. */
export type FontSessionMode = "preview" | "memory" | "workspace";

export type WorkspaceDocumentSourceKind = "untitled" | "document" | "imported";

/** Main-visible document lifecycle state owned by the utility workspace. */
export interface WorkspaceDocumentState {
  workspaceId: string;
  sourceKind: WorkspaceDocumentSourceKind;
  documentId: string | null;
  saveTarget: string | null;
  canonicalPath: string | null;
  dirty: boolean;
  needsSaveAs: boolean;
}
