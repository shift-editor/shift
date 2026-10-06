import { describe, expect, it } from "vitest";
import { mintPointId, mintRunId } from "@shift/types";
import { effect } from "../signals/index";
import { glyphTextItem } from "../text/layout";
import { currentEditingId } from "../../types/editing";
import { currentSelectionId } from "../../types/object";
import type { ShiftEditorRecord } from "../../types/records";
import type { StoreChange } from "../../types/store";
import type { TextRunRecord } from "../../types/text";
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

function run(...glyphNames: string[]): TextRunRecord {
  return {
    id: mintRunId(),
    type: "textrun",
    scope: "document",
    items: glyphNames.map((name) => glyphTextItem(name)),
  };
}

describe("ShiftStore per-record reads", () => {
  it("reruns a reader when its record changes and not when another record does", () => {
    const watched = run("A");
    const other = run("B");
    const store = new ShiftStore<ShiftEditorRecord>([watched, other]);
    const seen: (ShiftEditorRecord | null)[] = [];
    const reader = effect(() => {
      seen.push(store.record(watched.id));
    });

    store.put({ ...other, items: [] });
    const edited = { ...watched, items: [] };
    store.put(edited);
    store.delete(watched.id);
    reader.dispose();

    expect(seen).toEqual([watched, edited, null]);
  });

  it("delivers a record put after a reader saw it missing", () => {
    const store = new ShiftStore<ShiftEditorRecord>();
    const later = run("A");
    const seen: (ShiftEditorRecord | null)[] = [];
    const reader = effect(() => {
      seen.push(store.record(later.id));
    });

    store.put(later);
    reader.dispose();

    expect(seen).toEqual([null, later]);
  });
});

describe("ShiftStore indexes", () => {
  const byGlyph = (store: ShiftStore<ShiftEditorRecord>) =>
    store.index("textrun", (record) =>
      record.items.flatMap((item) => (item.kind === "glyph" ? [item.glyphName] : [])),
    );

  it("files records that existed before the index was created", () => {
    const first = run("A", "B");
    const store = new ShiftStore<ShiftEditorRecord>([first]);

    expect(byGlyph(store).get("B")).toEqual([first]);
  });

  it("moves a replaced record between keys and drops a deleted one", () => {
    const store = new ShiftStore<ShiftEditorRecord>();
    const index = byGlyph(store);
    const record = run("A");
    store.put(record);

    const renamed = { ...record, items: [glyphTextItem("C")] };
    store.put(renamed);
    expect(index.get("A")).toEqual([]);
    expect(index.get("C")).toEqual([renamed]);

    store.delete(record.id);
    expect(index.get("C")).toEqual([]);
  });

  it("ignores records of other types", () => {
    const store = new ShiftStore<ShiftEditorRecord>();
    const index = store.index("textrun", () => ["every run"]);
    store.put({ id: currentSelectionId, type: "selection", scope: "session", ids: [] });

    expect(index.get("every run")).toEqual([]);
  });

  it("reruns a reader of one key only when that key's records change", () => {
    const store = new ShiftStore<ShiftEditorRecord>();
    const index = byGlyph(store);
    let runs = 0;
    const reader = effect(() => {
      index.get("A");
      runs++;
    });

    store.put(run("B"));
    store.put(run("A"));
    reader.dispose();

    expect(runs).toBe(2);
  });

  it("stops following the store once disposed", () => {
    const store = new ShiftStore<ShiftEditorRecord>();
    const index = byGlyph(store);
    index.dispose();

    store.put(run("A"));

    expect(index.get("A")).toEqual([]);
  });
});
