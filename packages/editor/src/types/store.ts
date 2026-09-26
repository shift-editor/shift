import type { ShiftRecord } from "./records";

/** Describes one completed whole-record replacement in the editor store. */
export interface StoreChange<R extends ShiftRecord> {
  readonly id: R["id"];
  readonly before: R | null;
  readonly after: R | null;
}
