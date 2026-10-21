import type { GlyphId, SourceId } from "@shift/types";
import type { ShiftNodeRecord } from "./records";
import type { TextRunRecord } from "./text";

/**
 * The canvas as a document store keeps it.
 *
 * @remarks
 * Stores treat `payload` as opaque text; only the editor reads it, in the
 * format `version` names.
 */
export interface StoredSceneState {
  /** Payload format version, at least 1. */
  readonly version: number;
  /** Serialized {@link ScenePayload}. */
  readonly payload: string;
}

/**
 * Where an editor keeps its canvas between sessions.
 *
 * @remarks
 * The desktop app writes to the open `.shift` document through the workspace;
 * another document format implements the same two calls.
 */
export interface SceneStateStore {
  /**
   * Returns the canvas saved with the document.
   *
   * @returns null when the document has never stored one.
   */
  read(): Promise<StoredSceneState | null>;

  /**
   * Replaces the stored canvas. Writes issued in order land in order.
   *
   * @throws {Error} when the store cannot keep the canvas.
   */
  write(state: StoredSceneState): Promise<void>;
}

/** A document-scoped editor record kept with the document. */
export type PersistedSceneRecord = TextRunRecord | ShiftNodeRecord;

/**
 * The canvas records in one stored payload.
 *
 * @remarks
 * A flat list keyed by each record's `type` (and a node's `kind`), so later
 * record types such as pages extend it without a new container.
 */
export interface ScenePayload {
  readonly records: readonly PersistedSceneRecord[];
}

/** Configures how an editor keeps its canvas. */
export interface ScenePersistenceOptions {
  readonly store: SceneStateStore;
  /** Quiet time after the last canvas change before it is written; defaults to 500 ms. */
  readonly delayMs?: number;
}

/** A stored record that restoring left out, and why. */
export interface DroppedSceneRecord {
  readonly id: string;
  readonly reason: string;
}

/** Lookups a restore checks stored node references against. */
export interface SceneReferences {
  hasGlyph(glyphId: GlyphId): boolean;
  hasSource(sourceId: SourceId): boolean;
}

/** What restoring a stored canvas put back and what it left out. */
export interface SceneRestore {
  readonly restored: readonly PersistedSceneRecord[];
  readonly dropped: readonly DroppedSceneRecord[];
}
