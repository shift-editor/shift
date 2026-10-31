import type { PendingEditId } from "@shift/editor/types";
import type { SaveState } from "@shift/types";

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
}

export type WorkspaceApplyStatus = "idle" | "queued" | "applying";
