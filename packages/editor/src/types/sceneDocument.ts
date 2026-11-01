import type { NodeId } from "@shift/types";
import type {
  EditLocation,
  RevisedNode,
  RunSettings,
  SceneIntent,
  SceneNode,
} from "@shift/wasm/protocol";
import type { Signal } from "../lib/signals";

export type { RevisedNode, RunSettings, SceneIntent, SceneNode };

/**
 * Whether a scene edit is an undo step, as shift-engine's `Recording` says:
 * `"unrecorded"` edits are kept, and persisted, but undo passes over them.
 */
export type SceneRecording = "undoable" | "unrecorded";

/**
 * Where a {@link Scene} keeps its nodes, and how it edits them.
 *
 * @remarks
 * In a workspace this is the window's editing engine: the scene sits in the
 * engine's document beside the font, edits are engine intents in the one
 * undo history, and each is persisted as it is made. A session without an
 * engine (a preview, an in-memory session) holds the same Rust scene alone,
 * with nothing persisted.
 */
export interface SceneDocument {
  /** Changes whenever the nodes do; a reader tracks it to rerun after a scene edit, undo or redo. */
  readonly revisionCell: Signal<number>;
  /**
   * Every node, each root and then the nodes under it, each parent before its
   * children, siblings in order, with when it last changed.
   */
  nodes(): readonly RevisedNode[];
  /**
   * Applies `intents` in order, as one edit.
   *
   * @throws When an intent is refused; the scene is then as it was.
   */
  apply(intents: readonly SceneIntent[], recording: SceneRecording): void;
  /** Tells the document which page the editor shows, which each undo step records as where it was made. */
  followShownPage(shownPage: () => NodeId | null): void;
  /**
   * Tells the document how to show where an undo or redo was made, which it
   * calls as it replays the step, before the change is drawn.
   */
  followReplays(show: (location: EditLocation) => void): void;
}
