import { describe, expect, it } from "vitest";
import { mintPointId } from "@shift/types";
import { currentEditingId } from "../../types/editing";
import { currentSelectionId } from "../../types/object";
import type { ShiftEditorRecord } from "../../types/records";
import type { StoreChange } from "../../types/store";
import { ShiftStore } from "./ShiftStore";

describe("ShiftStore change publication", () => {
  it("publishes each record's exact replacement", () => {
    const store = new ShiftStore<ShiftEditorRecord>();
    const changes: StoreChange<ShiftEditorRecord>[] = [];
    const first: ShiftEditorRecord = {
      id: currentSelectionId,
      type: "selection",
      scope: "session",
      ids: [],
    };
    const second: ShiftEditorRecord = { ...first, ids: [mintPointId()] };
    store.onChange((change) => changes.push(change));

    store.put(first);
    store.put(second);
    store.delete(currentSelectionId);

    expect(changes).toEqual([
      { id: currentSelectionId, before: null, after: first },
      { id: currentSelectionId, before: first, after: second },
      { id: currentSelectionId, before: second, after: null },
    ]);
  });

  it("publishes every removed record when clearing", () => {
    const records: ShiftEditorRecord[] = [
      { id: currentSelectionId, type: "selection", scope: "session", ids: [] },
      { id: currentEditingId, type: "editing", scope: "session", nodeIds: [] },
    ];
    const store = new ShiftStore(records);
    const changes: StoreChange<ShiftEditorRecord>[] = [];
    store.onChange((change) => changes.push(change));

    store.clear();

    expect(changes).toEqual(
      records.map((record) => ({ id: record.id, before: record, after: null })),
    );
  });
});
