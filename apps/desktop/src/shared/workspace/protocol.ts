import type {
  AppliedChange,
  Axis,
  AxisMapping,
  CatalogAtlasPage,
  CatalogAtlasWeights,
  CatalogDirectory,
  DisplayGlyph,
  FontIntent,
  FontMetadata,
  FontMetrics,
  GlyphId,
  GlyphPreview,
  GlyphProjection,
  GlyphRecord,
  GlyphState,
  Location,
  MetricDefinition,
  SourceMetricsInterpolationSnapshot,
  NamedInstance,
  SlugAtlas,
  Source,
  SourceId,
} from "@shift/types";

/**
 * Point-in-time view of the open workspace: identity and records, no geometry.
 */
export type WorkspaceSnapshot = {
  documentId: string;
  metadata: FontMetadata;
  metrics: FontMetrics;
  metricDefinitions: MetricDefinition[];
  sourceMetricsInterpolation: SourceMetricsInterpolationSnapshot | null;
  glyphs: GlyphRecord[];
  sources: Source[];
  axes: Axis[];
  axisMappings: AxisMapping[];
  namedInstances: NamedInstance[];
};

export type WorkspaceGlyphLayerSnapshot = {
  glyphId: GlyphId;
  sourceId: SourceId;
  state: GlyphState;
};

export type WorkspaceGlyphSnapshotRequest = {
  glyphId: GlyphId;
};

export type WorkspaceGlyphSnapshot = {
  glyphId: GlyphId;
  projection?: GlyphProjection;
  layers: WorkspaceGlyphLayerSnapshot[];
};

/** Process-local origin required to stream or discard one prepared atlas page. */
export type SlugAtlasOrigin = "native" | "cached";

/** Prepared page descriptor paired with its utility-owned byte origin. */
export type WorkspaceSlugAtlas = SlugAtlas & {
  origin: SlugAtlasOrigin;
};

/** One deterministic fixed-page request within the current authored revision. */
export type WorkspaceSlugAtlasPageRequest = {
  glyphIds: GlyphId[];
  alignment: number;
  pageIndex: number;
  pageCount: number;
  replacementPageIndices: number[];
};

export type WorkspaceDocumentSourceKind = "untitled" | "package" | "imported";

/** Immutable product mode for one live font session. */
export type FontSessionMode = "shift" | "preview";

/** Main-visible identity for one retained, read-only foreign source session. */
export type FontSourceSessionState = {
  sessionId: string;
  canonicalPath: string;
};

/** Renderer catch-up state for the retained backend of the shared catalog. */
export type FontSourceSnapshot = FontSourceSessionState & {
  directory: CatalogDirectory;
};

/** One deterministic page request expressed in source-local glyph indexes. */
export type FontSourceAtlasPageRequest = {
  pageIndex: number;
  glyphIndices: number[];
  coordinates: number[];
  alignment: number;
};

/** Bounded byte delivery over a dedicated transferred port. */
export type ByteStreamMessage =
  | { kind: "chunk"; offset: number; bytes: Uint8Array<ArrayBuffer> }
  | { kind: "complete"; totalLength: number }
  | { kind: "error"; message: string };

/** Receiver backpressure for a dedicated bounded byte stream. */
export type ByteStreamControl =
  | { kind: "ack"; nextOffset: number }
  | { kind: "cancel"; message: string };

/** Minimal readable-stream contract shared by native and web streams. */
export interface ByteReadableStream<T> {
  getReader(): ByteReadableStreamReader<T>;
}

export interface ByteReadableStreamReader<T> {
  read(): Promise<{ done: false; value: T } | { done: true; value: undefined }>;
  cancel(reason?: unknown): Promise<void>;
  releaseLock(): void;
}

/** Identifies one concrete `.shift` package instance on disk. */
export type WorkspacePackageIdentity = {
  packageId: string;
  canonicalPath: string;
  fingerprint: string;
};

/**
 * Main-visible document lifecycle state owned by the utility workspace.
 *
 * @remarks
 * `dirty` is the single semantic answer to "are there unsaved changes"; the
 * utility owns the version arithmetic that derives it and never ships the raw
 * counters. `needsSaveAs` is likewise derived from the source kind. Main
 * treats both as utility-owned state, not renderer queue state.
 */
export type WorkspaceDocumentState = {
  documentId: string;
  sourceKind: WorkspaceDocumentSourceKind;
  saveTarget: string | null;
  packageId: string | null;
  canonicalPath: string | null;
  dirty: boolean;
  needsSaveAs: boolean;
};

/** Identifies the compiled font written by a workspace export. */
export type WorkspaceExportResult = {
  path: string;
  format: "ttf";
};

/**
 * Shell lane: main ↔ utility. Plumbing only; never font data.
 *
 * @remarks
 * `workspace.connect` carries the renderer's sync-lane port as a transferred
 * port, not as payload. Create/open return document lifecycle state only; font
 * records stay on the sync lane. Save is NOT here: it rides the sync lane as a
 * committed operation so FIFO orders it behind edits (see `workspace.save`).
 * Main reads `document.state` to decide Save vs Save As and learns save
 * outcomes from the `document.changed` event.
 */
export type ShellCallMap = {
  "workspace.create": { request: void; response: WorkspaceDocumentState };
  "workspace.inspectPackage": {
    request: { path: string };
    response: WorkspacePackageIdentity;
  };
  "workspace.open": {
    request: { path: string };
    response: WorkspaceDocumentState;
  };
  "workspace.close": { request: { discard: boolean }; response: null };
  "source.open": {
    request: { path: string };
    response: FontSourceSessionState;
  };
  "source.close": { request: void; response: null };
  "workspace.connect": { request: void; response: void };
  "document.state": { request: void; response: WorkspaceDocumentState | null };
};

export type ShellEventMap = {
  ready: void;
  "document.changed": WorkspaceDocumentState | null;
};

/**
 * Sync lane: renderer ↔ utility.
 *
 * @remarks
 * Convention: **every sync-lane response is the renderer's next state** —
 * states, not acks. Create/open are main-owned shell-lane operations; the
 * renderer catches up by reading `workspace.snapshot`.
 */
export type SyncCallMap = {
  "workspace.snapshot": { request: void; response: WorkspaceSnapshot | null };
  "source.snapshot": { request: void; response: FontSourceSnapshot | null };
  "source.glyph": {
    request: { glyphIndex: number; coordinates: number[] };
    response: DisplayGlyph;
  };
  "source.atlasPagePrepare": {
    request: FontSourceAtlasPageRequest;
    response: CatalogAtlasPage;
  };
  "source.atlasPageStream": {
    request: { generation: number; maximumLength: number };
    response: null;
  };
  "source.atlasPageDiscard": {
    request: { pageIndex: number; generation: number };
    response: null;
  };
  "source.atlasWeights": {
    request: { coordinates: number[] };
    response: CatalogAtlasWeights[];
  };
  "document.state": { request: void; response: WorkspaceDocumentState | null };
  /**
   * The one mutation verb. Requests carry intents; the response is pure
   * replace-grade state (never change records — the renderer substitutes,
   * it does not interpret).
   */
  "workspace.apply": {
    request: { intents: FontIntent[]; label?: string };
    response: { applied: AppliedChange; documentState: WorkspaceDocumentState };
  };
  /** Replays the most recent ledger entry; null when the stack is empty. */
  "workspace.undo": {
    request: void;
    response: {
      applied: AppliedChange | null;
      documentState: WorkspaceDocumentState | null;
    };
  };
  "workspace.redo": {
    request: void;
    response: {
      applied: AppliedChange | null;
      documentState: WorkspaceDocumentState | null;
    };
  };
  /**
   * Saves to the current package target, or rejects when the document still
   * needs a path. Rides the edit lane so the utility serializes it behind every
   * committed edit — no cross-lane watermark required.
   */
  "workspace.save": { request: void; response: WorkspaceDocumentState };
  /** Saves to `path` (main's Save As dialog choice) and adopts it as target. */
  "workspace.saveAs": {
    request: { path: string };
    response: WorkspaceDocumentState;
  };
  /** Captures the committed workspace and compiles it without changing document state. */
  "workspace.export": {
    request: { path: string };
    response: WorkspaceExportResult;
  };
  "workspace.glyphSnapshots": {
    request: { requests: WorkspaceGlyphSnapshotRequest[] };
    response: WorkspaceGlyphSnapshot[];
  };
  "workspace.glyphProjections": {
    request: { glyphIds: GlyphId[] };
    response: GlyphProjection[];
  };
  /** Resolves drawable previews (svg path + advance) at one internal location. */
  "workspace.glyphPreviews": {
    request: { glyphIds: GlyphId[]; location: Location };
    response: GlyphPreview[];
  };
  /** Builds one native, location-independent authored Slug generation. */
  "workspace.slugAtlasPrepare": {
    request: { alignment: number };
    response: SlugAtlas;
  };
  /** Opens or builds one fixed root-glyph page and its component closure. */
  "workspace.slugAtlasPagePrepare": {
    request: WorkspaceSlugAtlasPageRequest;
    response: WorkspaceSlugAtlas;
  };
  /** Streams bounded atlas chunks over the transferred response port. */
  "workspace.slugAtlasStream": {
    request: { generation: number; maximumLength: number };
    response: null;
  };
  /** Streams one prepared page over the transferred response port. */
  "workspace.slugAtlasPageStream": {
    request: { generation: number; origin: SlugAtlasOrigin; maximumLength: number };
    response: null;
  };
  /** Releases native CPU residency when adapter initialization is rejected. */
  "workspace.slugAtlasDiscard": {
    request: { generation: number };
    response: null;
  };
  /** Releases one rejected prepared page. */
  "workspace.slugAtlasPageDiscard": {
    request: { generation: number; origin: SlugAtlasOrigin };
    response: null;
  };
  /** Evaluates font-owned independent and cross-axis mappings in Rust. */
  "workspace.mapLocation": { request: Location; response: Location };
};

export type SyncEventMap = {
  "document.changed": WorkspaceDocumentState | null;
};
