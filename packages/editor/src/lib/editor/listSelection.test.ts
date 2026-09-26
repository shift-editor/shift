import { describe, expect, it } from "vitest";
import { applyListSelection } from "./listSelection";

const orderedIds = ["a", "b", "c", "d"];

describe("list selection follows desktop modifier behavior", () => {
  it("replaces the selection for a single item", () => {
    expect(applyListSelection(orderedIds, ["a", "b"], "a", "c", "single")).toEqual(["c"]);
  });

  it("selects an inclusive range in either direction", () => {
    expect(applyListSelection(orderedIds, ["b"], "b", "d", "range")).toEqual(["b", "c", "d"]);
    expect(applyListSelection(orderedIds, ["d"], "d", "b", "range")).toEqual(["b", "c", "d"]);
  });

  it("toggles one item without replacing the other selected items", () => {
    expect(applyListSelection(orderedIds, ["a", "c"], "a", "b", "toggle")).toEqual(["a", "c", "b"]);
    expect(applyListSelection(orderedIds, ["a", "c"], "a", "c", "toggle")).toEqual(["a"]);
  });

  it("falls back to the target when the range anchor is unavailable", () => {
    expect(applyListSelection(orderedIds, ["a"], "missing", "c", "range")).toEqual(["c"]);
  });

  it("supports value equality for non-primitive items", () => {
    const orderedItems = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const isSameItem = (left: { id: string }, right: { id: string }) => left.id === right.id;

    expect(
      applyListSelection(
        orderedItems,
        [{ id: "a" }],
        { id: "a" },
        { id: "c" },
        "range",
        isSameItem,
      ),
    ).toEqual(orderedItems);
  });
});
