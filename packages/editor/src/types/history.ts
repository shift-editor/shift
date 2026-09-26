import type { HistoryCapture } from "../lib/editor/history/HistoryCapture";
import type { PendingEditId } from "./editing";
import type { ShiftEditorRecord, ShiftRecordId } from "./records";

/** Reversible whole-record replacement owned by the TypeScript editor. */
export interface RecordChange {
  readonly id: ShiftRecordId;
  readonly before: ShiftEditorRecord | null;
  readonly after: ShiftEditorRecord | null;
}

/** One or more editor-record replacements completed by the same user action. */
export interface RecordHistoryEffect {
  readonly kind: "records";
  readonly changes: readonly RecordChange[];
}

/** Marks one ordered document mutation owned by the workspace ledger. */
export interface WorkspaceEffect {
  readonly kind: "workspace";
}

export type HistoryEffect = RecordHistoryEffect | WorkspaceEffect;

export type HistoryDirection = "undo" | "redo";

/** One completed user action in the unified editor/document timeline. */
export interface HistoryEntry {
  readonly label: string;
  readonly effects: readonly HistoryEffect[];
}

/** Reports the renderer-local lifecycle of an accepted workspace mutation. */
export type WorkspaceEditEvent =
  | { readonly kind: "accepted"; readonly id: PendingEditId }
  | { readonly kind: "committed"; readonly id: PendingEditId }
  | { readonly kind: "failed"; readonly id: PendingEditId; readonly error: unknown };

export type WorkspaceEditListener = (event: WorkspaceEditEvent) => void;

export interface HistoryCaptureContext {
  readonly capture: HistoryCapture;
  readonly label: string;
  readonly before: ReadonlyMap<ShiftRecordId, ShiftEditorRecord>;
  readonly editIds: PendingEditId[];
}

export interface PendingHistoryEffect {
  readonly effect: WorkspaceEffect;
  entry: HistoryEntry | null;
  outcome: "pending" | "committed" | "failed";
  discardWorkspaceRedo: boolean;
}
