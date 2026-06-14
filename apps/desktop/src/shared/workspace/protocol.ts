import type {
  AppliedChange,
  Axis,
  FontIntent,
  FontMetadata,
  FontMetrics,
  GlyphId,
  GlyphRecord,
  GlyphState,
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
};

export type WorkspaceDocumentSourceKind = "untitled" | "package" | "imported";

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
  dirty: boolean;
  needsSaveAs: boolean;
};

/**
 * Shell lane: main ↔ utility. Plumbing only; never font data.
 *
 * @remarks
 * `workspace.connect` carries the renderer's sync-lane port as a transferred
 * port, not as payload. Save is NOT here: it rides the sync lane as a committed
 * operation so FIFO orders it behind edits (see `workspace.save`). Main reads
 * `document.state` to decide Save vs Save As and learns save outcomes from the
 * `document.changed` event.
 */
export type ShellCallMap = {
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
 * states, not acks. `workspace.create` takes void because the utility mints
 * the documentId and allocates the store path; the renderer never sees a
 * filesystem path.
 */
export type SyncCallMap = {
  "workspace.create": { request: void; response: WorkspaceSnapshot };
  "workspace.snapshot": { request: void; response: WorkspaceSnapshot | null };
  /**
   * The one mutation verb. Requests carry intents; the response is pure
   * replace-grade state (never change records — the renderer substitutes,
   * it does not interpret).
   */
  "workspace.apply": {
    request: { intents: FontIntent[]; label?: string };
    response: AppliedChange;
  };
  /** Replays the most recent ledger entry; null when the stack is empty. */
  "workspace.undo": { request: void; response: AppliedChange | null };
  "workspace.redo": { request: void; response: AppliedChange | null };
  /**
   * Saves to the current package target, or rejects when the document still
   * needs a path. Rides the edit lane so the utility serializes it behind every
   * committed edit — no cross-lane watermark required.
   */
  "workspace.open": { request: { path: string }; response: WorkspaceSnapshot };
  "workspace.save": { request: void; response: WorkspaceDocumentState };
  /** Saves to `path` (main's Save As dialog choice) and adopts it as target. */
  "workspace.saveAs": { request: { path: string }; response: WorkspaceDocumentState };
  /**
   * Pulls replace-grade glyph state for one source (resync + editor open).
   * Addressed by stable GlyphId — references survive renames.
   */
  "workspace.glyph": {
    request: { glyphId: GlyphId; sourceId: SourceId };
    response: GlyphState | null;
  };
};

export type SyncEventMap = Record<string, never>;
