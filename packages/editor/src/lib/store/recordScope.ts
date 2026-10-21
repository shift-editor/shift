import type { ShiftEditorRecord } from "../../types/records";

/**
 * Whether a record is session state rather than document content.
 *
 * @remarks
 * A record is document content unless it declares `scope: "session"`.
 * Selection, editing, and the text caret declare it; scene nodes and text
 * runs do not, so they are document content: history replays them before
 * session records, and the scene's persistence keeps them with the document.
 */
export function isSessionRecord(record: ShiftEditorRecord | null): boolean {
  return record !== null && "scope" in record && record.scope === "session";
}
