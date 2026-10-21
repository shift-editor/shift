import { describe, expect, it } from "vitest";
import { alphabetical, ascending, byName, comparing, descending, orderBy } from "@shift/types";

describe("named orders", () => {
  it("orders numbers either way and strings in locale order", () => {
    expect([3, -1, 2].toSorted(ascending)).toEqual([-1, 2, 3]);
    expect([3, -1, 2].toSorted(descending)).toEqual([3, 2, -1]);
    expect(["b", "a", "c"].toSorted(alphabetical)).toEqual(["a", "b", "c"]);
  });

  it("orders named values by name", () => {
    const groups = [{ name: "O" }, { name: "H" }, { name: "n" }];

    expect(groups.toSorted(byName).map(({ name }) => name)).toEqual(["H", "n", "O"]);
  });

  it("orders by a key, keeping equal keys in their original order", () => {
    const entries = [
      { path: "a", openedAt: 1 },
      { path: "b", openedAt: 3 },
      { path: "c", openedAt: 1 },
    ];

    const newestFirst = comparing((entry: (typeof entries)[number]) => entry.openedAt, descending);

    expect(entries.toSorted(newestFirst).map(({ path }) => path)).toEqual(["b", "a", "c"]);
  });

  it("breaks ties with each later comparator in turn", () => {
    const files = [
      { name: "b", touched: 2 },
      { name: "c", touched: 1 },
      { name: "a", touched: 2 },
    ];
    const oldestThenName = orderBy<(typeof files)[number]>(
      comparing((file) => file.touched, ascending),
      comparing((file) => file.name, alphabetical),
    );

    expect(files.toSorted(oldestThenName).map(({ name }) => name)).toEqual(["c", "a", "b"]);
  });
});
