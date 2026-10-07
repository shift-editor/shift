import type { ShiftRecord } from "./records";

/** Describes one completed whole-record replacement in the editor store. */
export interface StoreChange<R extends ShiftRecord> {
  readonly id: R["id"];
  readonly before: R | null;
  readonly after: R | null;
}

/** The store surface a `StoreIndex` follows: its current records and its change stream. */
export interface StoreIndexSource {
  records(): readonly ShiftRecord[];
  onChange(listener: (change: StoreChange<ShiftRecord>) => void): () => void;
}
