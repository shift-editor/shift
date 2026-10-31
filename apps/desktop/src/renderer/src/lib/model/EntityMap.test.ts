import { describe, expect, it } from "vitest";
import { EntityMap, EntityNotFoundError } from "@shift/types";

describe("EntityMap", () => {
  it("returns null, not undefined, for a missing key", () => {
    const windows = new EntityMap<number, string>("window", [[1, "main"]]);

    expect(windows.get(1)).toBe("main");
    expect(windows.get(2)).toBeNull();
  });

  it("names the kind and key when a required entity is missing", () => {
    const windows = new EntityMap<number, string>("window");

    expect(() => windows.require(7)).toThrow(EntityNotFoundError);
    expect(() => windows.require(7)).toThrow("window 7 not found");
  });

  it("keeps insertion order for iteration and where", () => {
    const groups = new EntityMap<string, number>("group");
    groups.set("b", 2).set("a", 1).set("c", 3);

    expect([...groups.keys()]).toEqual(["b", "a", "c"]);
    expect(groups.where((value) => value > 1)).toEqual([2, 3]);
  });
});
