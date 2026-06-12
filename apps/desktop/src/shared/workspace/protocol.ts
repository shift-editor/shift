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

/**
 * Shell lane: main ↔ utility. Plumbing only; never font data.
 *
 * @remarks
 * `workspace.connect` carries the renderer's sync-lane port as a transferred
 * port, not as payload.
 */
export type ShellCallMap = {
  "workspace.connect": { request: void; response: void };
};

export type ShellEventMap = { ready: void };

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
   * Pulls replace-grade glyph state for one source (resync + editor open).
   * Addressed by stable GlyphId — references survive renames.
   */
  "workspace.glyph": {
    request: { glyphId: GlyphId; sourceId: SourceId };
    response: GlyphState | null;
  };
};

export type SyncEventMap = Record<string, never>;
