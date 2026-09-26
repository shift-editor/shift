import type { RecordChange } from "../../../types/history";
import type { ShiftEditorRecord, ShiftRecordId } from "../../../types/records";

/** Returns the semantic whole-record changes between two immutable store maps. */
export function recordChanges(
  before: ReadonlyMap<ShiftRecordId, ShiftEditorRecord>,
  after: ReadonlyMap<ShiftRecordId, ShiftEditorRecord>,
): RecordChange[] {
  const ids = new Set<ShiftRecordId>([...before.keys(), ...after.keys()]);
  const changes: RecordChange[] = [];

  for (const id of ids) {
    const previous = before.get(id) ?? null;
    const next = after.get(id) ?? null;
    if (editorRecordsEqual(previous, next)) continue;

    changes.push({ id, before: previous, after: next });
  }

  return changes;
}

/** Compares editor records by value rather than transient object identity. */
export function editorRecordsEqual(
  left: ShiftEditorRecord | null,
  right: ShiftEditorRecord | null,
): boolean {
  return valuesEqual(left, right);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;

    return left.every((value, index) => valuesEqual(value, right[index]));
  }

  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every(
    (key) => Object.hasOwn(rightRecord, key) && valuesEqual(leftRecord[key], rightRecord[key]),
  );
}
