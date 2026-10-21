import { describe, expect, it } from "vitest";
import { RecentList, type RecentListRules } from "@shift/types";

interface Entry {
  readonly path: string;
  readonly documentId: string | null;
  readonly openedAt: number;
  readonly open?: boolean;
}

type Visit = Pick<Entry, "path" | "documentId">;

const rules: RecentListRules<Entry, Visit> = {
  matches: (entry, visit) =>
    entry.path === visit.path ||
    (visit.documentId !== null && entry.documentId === visit.documentId),
  usedAt: (entry) => entry.openedAt,
  limit: 3,
};

const entry = (path: string, openedAt: number, documentId: string | null = null): Entry => ({
  path,
  documentId,
  openedAt,
});
const paths = (list: RecentList<Entry, Visit>) => list.items.map(({ path }) => path);
const visit = (path: string, documentId: string | null = null): Visit => ({ path, documentId });
const opened =
  (path: string, openedAt: number, documentId: string | null = null) =>
  () =>
    entry(path, openedAt, documentId);

describe("RecentList", () => {
  it("orders newest first and caps at the limit", () => {
    const list = RecentList.of([entry("a", 1), entry("d", 4), entry("b", 2), entry("c", 3)], rules);

    expect(paths(list)).toEqual(["d", "c", "b"]);
  });

  it("moves a touched item to the front and drops the oldest past the limit", () => {
    let list = RecentList.of([entry("a", 1), entry("b", 2), entry("c", 3)], rules);

    list = list.touch(visit("a"), opened("a", 4));
    expect(paths(list)).toEqual(["a", "c", "b"]);

    list = list.touch(visit("e"), opened("e", 5));
    expect(paths(list)).toEqual(["e", "a", "c"]);
  });

  it("keeps one item per document, matched by path or by id", () => {
    const list = RecentList.of([entry("old.shift", 1, "doc-1"), entry("b", 2)], rules);

    const moved = list.touch(visit("new.shift", "doc-1"), opened("new.shift", 3, "doc-1"));
    expect(paths(moved)).toEqual(["new.shift", "b"]);

    const byPath = moved.touch(visit("b", "doc-2"), (previous) => ({ ...previous!, openedAt: 4 }));
    expect(paths(byPath)).toEqual(["b", "new.shift"]);
  });

  it("hands touch the item it replaces", () => {
    const list = RecentList.of([{ ...entry("a", 1), open: true }], rules);

    const touched = list.touch(visit("a"), (previous) => ({ ...previous!, openedAt: 2 }));

    expect(touched.find(visit("a"))).toEqual({ ...entry("a", 2), open: true });
  });

  it("puts an older item back in its time order", () => {
    const list = RecentList.of([entry("a", 1), entry("c", 3)], rules);

    expect(paths(list.touch(visit("b"), opened("b", 2)))).toEqual(["c", "b", "a"]);
  });

  it("updates the first match in place and leaves the list alone when none matches", () => {
    const list = RecentList.of([entry("a", 1), entry("b", 2)], rules);

    const updated = list.update(visit("a"), (item) => ({ ...item, open: true }));

    expect(updated.items).toEqual([entry("b", 2), { ...entry("a", 1), open: true }]);
    expect(list.update(visit("z"), (item) => item)).toBe(list);
  });

  it("removes every match, by path alone when the query has no id", () => {
    const list = RecentList.of([entry("a", 2, "doc-1"), entry("b", 1, "doc-1")], rules);

    expect(paths(list.remove(visit("a")))).toEqual(["b"]);
    expect(paths(list.remove(visit("a", "doc-1")))).toEqual([]);
    expect(list.remove(visit("z"))).toBe(list);
    expect(list.remove(visit("a", "doc-1")).isEmpty).toBe(true);
  });

  it("finds and filters newest first", () => {
    const list = RecentList.of([{ ...entry("a", 1), open: true }, entry("b", 2)], rules);

    expect(list.find(visit("b"))).toEqual(entry("b", 2));
    expect(list.find(visit("z"))).toBeNull();
    expect(list.where((item) => item.open === true).map(({ path }) => path)).toEqual(["a"]);
    expect([...list].map(({ path }) => path)).toEqual(["b", "a"]);
  });
});
