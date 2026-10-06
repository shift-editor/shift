import { describe, expect, it } from "vitest";
import { Tree } from "./Tree";

interface Item {
  id: string;
  parentId: string | null;
  index: string;
}

const item = (id: string, parentId: string | null, index = "a0"): Item => ({ id, parentId, index });
const keys = {
  id: (entry: Item) => entry.id,
  parentId: (entry: Item) => entry.parentId,
  order: (a: Item, b: Item) => a.index.localeCompare(b.index),
};
const ids = (items: Iterable<Item>) => [...items].map((entry) => entry.id);

describe("Tree", () => {
  it("walks parents before children with siblings in order", () => {
    const tree = Tree.from(
      [item("b", null, "a1"), item("b2", "b", "a1"), item("a", null, "a0"), item("b1", "b", "a0")],
      keys,
    );
    expect(ids(tree.walk())).toEqual(["a", "b", "b1", "b2"]);
    expect(ids(tree.roots())).toEqual(["a", "b"]);
    expect(ids(tree.children("b"))).toEqual(["b1", "b2"]);
  });

  it("answers parent, ancestors, and descendants", () => {
    const tree = Tree.from([item("root", null), item("mid", "root"), item("leaf", "mid")], keys);
    expect(tree.parent("leaf")?.id).toBe("mid");
    expect(tree.parent("root")).toBeNull();
    expect(ids(tree.ancestors("leaf"))).toEqual(["mid", "root"]);
    expect(ids(tree.descendants("root"))).toEqual(["mid", "leaf"]);
  });

  it("treats an item whose parent is missing as a root", () => {
    const tree = Tree.from([item("orphan", "gone")], keys);
    expect(ids(tree.roots())).toEqual(["orphan"]);
    expect(tree.parent("orphan")).toBeNull();
  });

  it("drops a parent cycle from the walk instead of looping", () => {
    const tree = Tree.from([item("x", "y"), item("y", "x"), item("root", null)], keys);
    expect(ids(tree.walk())).toEqual(["root"]);
    expect(ids(tree.ancestors("x"))).toEqual(["y"]);
  });

  it("returns empty children and null lookups for unknown ids", () => {
    const tree = Tree.from([item("a", null)], keys);
    expect(tree.children("missing")).toEqual([]);
    expect(tree.get("missing")).toBeNull();
  });
});
