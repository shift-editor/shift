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
  SceneState,
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
  /** The editor's canvas stored with the document; `null` when none was ever written. */
  sceneState: SceneState | null;
}

/**
 * What the workspace's store answers at open: a {@link WorkspaceSnapshot}
 * without the axes, sources, kerning and glyph records, which the window
 * reads from its engine.
 */
export type StoredWorkspaceSnapshot = Omit<WorkspaceSnapshot, keyof EngineFontRecords>;

/**
 * The axes, sources and kerning of an open font, as the window's engine
 * reads them from its own font without asking its store.
 */
export type EngineStorelessRecords = Pick<WorkspaceSnapshot, "axes" | "sources" | "kerning">;

/** The axes, sources, kerning and glyph records of an open font, as the window's engine reads them. */
export type EngineFontRecords = EngineStorelessRecords & Pick<WorkspaceSnapshot, "glyphs">;

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
