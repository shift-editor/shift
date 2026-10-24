import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseEach } from "./parseEach";

const entry = z.object({ path: z.string(), openedAt: z.number() });

describe("parseEach", () => {
  it("keeps each entry the schema accepts and drops malformed ones", () => {
    const text = JSON.stringify([
      { path: "a", openedAt: 1 },
      { path: "b" },
      "not an entry",
      { path: "c", openedAt: 3 },
    ]);

    expect(parseEach(entry, text)).toEqual([
      { path: "a", openedAt: 1 },
      { path: "c", openedAt: 3 },
    ]);
  });

  it("reads JSON that is not an array as empty", () => {
    expect(parseEach(entry, JSON.stringify({ path: "a", openedAt: 1 }))).toEqual([]);
    expect(parseEach(entry, "null")).toEqual([]);
  });

  it("reads text that is not JSON as empty", () => {
    expect(parseEach(entry, "{not json")).toEqual([]);
    expect(parseEach(entry, "")).toEqual([]);
  });
});
