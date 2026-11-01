import type { PendingEditId } from "@shift/editor/types";
import type { GlyphId, SaveState } from "@shift/types";

/** An edit the window's engine applied, waiting to be persisted. */
export interface WorkspaceEdit {
  readonly id: PendingEditId;
  /** Its change set, as named MessagePack. */
  readonly changeSet: Uint8Array;
  /** A new edit, announced to edit listeners, or an undo or redo replayed from the history. */
  readonly origin: "edit" | "replay";
  /** Where the edit leaves the font, as the engine's history claims. */
  readonly saveState: SaveState;
  readonly label?: string;
  /**
   * The glyphs whose layer records the engine changed when it applied the
   * edit, whose projections the workspace rebuilds once it has persisted it.
   */
  readonly relayered: readonly GlyphId[];
}

/** How the edit coordinator queues one change set; each field has the default a new edit takes. */
export interface EditAcceptance {
  /** Defaults to `"edit"`. */
  readonly origin?: WorkspaceEdit["origin"];
  /** Defaults to `"unsaved"`. */
  readonly saveState?: SaveState;
  /**
   * Whether it changed the font, not only the scene; only then does the
   * authored revision advance. Defaults to true.
   */
  readonly changesFont?: boolean;
}

export type WorkspaceApplyStatus = "idle" | "queued" | "applying";
