import type {
  AppliedChange,
  Axis,
  AxisMapping,
  FontIntent,
  FontMetadata,
  FontMetrics,
  GlyphId,
  GlyphProjection,
  GlyphRecord,
  GlyphState,
  Location,
  NamedInstance,
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

export type WorkspaceDocumentSourceKind = "untitled" | "package" | "imported";

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
  /** Evaluates font-owned independent and cross-axis mappings in Rust. */
  "workspace.mapLocation": { request: Location; response: Location };
};

export type SyncEventMap = {
  "document.changed": WorkspaceDocumentState | null;
};
