import { describe, expect, it } from "vitest";
import { NameQuery } from "./NameQuery";

const groups = [{ name: "O_round" }, { name: "H_straight" }, { name: "o_lower" }];

describe("NameQuery", () => {
  it("matches names containing the trimmed text, ignoring case", () => {
    const query = NameQuery.from("  O_ ");

    expect(query.text).toBe("O_");
    expect(query.filter(groups).map(({ name }) => name)).toEqual(["O_round", "o_lower"]);
    expect(query.matches({ name: "H_straight" })).toBe(false);
  });

  it("matches everything when nothing is typed", () => {
    const query = NameQuery.from("   ");

    expect(query.isEmpty).toBe(true);
    expect(query.filter(groups)).toEqual(groups);
    expect(NameQuery.EMPTY.matches({ name: "anything" })).toBe(true);
  });

  it("drops a leading prefix only when the text starts with it", () => {
    expect(NameQuery.from("@round", { prefix: "@" }).text).toBe("round");
    expect(NameQuery.from(" @round", { prefix: "@" }).text).toBe("@round");
    expect(NameQuery.from("@round").text).toBe("@round");
  });

  it("searches other fields and tells an exact match from a partial one", () => {
    const scripts = [{ script: "Latin" }, { script: "Cyrillic" }];
    const query = NameQuery.from("lat");

    expect(query.filterBy(scripts, ({ script }) => [script])).toEqual([{ script: "Latin" }]);
    expect(query.isExactly("LAT")).toBe(true);
    expect(query.isExactly("Latin")).toBe(false);
  });
});
