import type {
  Axis,
  AxisMapping,
  AxisMappingBasis,
  FontMetadata,
  FontMetrics,
  GlyphRecord,
  KerningSnapshot,
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
  metricDefinitions: readonly MetricDefinition[];
  sourceMetricsInterpolation: SourceMetricsInterpolationSnapshot | null;
  glyphs: readonly GlyphRecord[];
  sources: readonly Source[];
  axes: readonly Axis[];
  axisMappings: readonly AxisMapping[];
  axisMappingBases: readonly AxisMappingBasis[];
  namedInstances: readonly NamedInstance[];
  /** Tracked Hyperglot language ids; `null` when the font stores no list. */
  languageIds: readonly string[] | null;
  kerning: KerningSnapshot;
}

/**
 * What the workspace's store answers at open: a {@link WorkspaceSnapshot}
 * without the axes, sources and kerning, which the window reads from its
 * engine.
 */
export type StoredWorkspaceSnapshot = Omit<WorkspaceSnapshot, "axes" | "sources" | "kerning">;

/** The axes, sources and kerning of an open font, as the window's engine reads them. */
export type EngineFontRecords = Pick<WorkspaceSnapshot, "axes" | "sources" | "kerning">;

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
