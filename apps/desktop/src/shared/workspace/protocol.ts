import type { FontMetadata, FontMetrics, GlyphRecord, Source } from "@shift/types";

/**
 * Point-in-time view of the open workspace: identity and records, no geometry.
 */
export type WorkspaceSnapshot = {
  documentId: string;
  metadata: FontMetadata;
  metrics: FontMetrics;
  glyphs: GlyphRecord[];
  sources: Source[];
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
};

export type SyncEventMap = Record<string, never>;
