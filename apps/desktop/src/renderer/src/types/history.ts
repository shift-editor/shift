import type { LedgerEntryId } from "@shift/types";
import type { PendingEditId } from "./editing";
import type { SelectableId } from "./object";

/** One reversible contiguous difference between two ordered sequences. */
export interface SequenceDiff<T> {
  readonly start: number;
  readonly removed: readonly T[];
  readonly inserted: readonly T[];
}

/** Observes one complete ordered selection replacement. */
export type SelectionListener = (
  before: readonly SelectableId[],
  after: readonly SelectableId[],
) => void;

/** Reversible changes to explicitly undoable renderer-owned editor properties. */
export interface EditorDiff {
  readonly selection?: SequenceDiff<SelectableId>;
}

/** One user action combining optional document replay with renderer-owned changes. */
export interface HistoryItem {
  readonly document: PendingEditId | LedgerEntryId | null;
  readonly editor: EditorDiff | null;
}
