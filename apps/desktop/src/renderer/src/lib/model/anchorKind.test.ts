import { describe, expect, it } from "vitest";
import { createBridge } from "@shift/bridge";
import { anchorKind } from "@shift/editor/model";

const NAMES = [
  "top",
  "bottom",
  "ogonek",
  "_top",
  "_bottom",
  "top_1",
  "top_2",
  "top_10",
  "top_0",
  "_top_1",
  "_",
  "_3",
  "_0",
  "caret_1",
  "caret_2",
  "caret_",
  "caret_x",
  "caret_0",
  "vcaret_1",
  "vcaret_",
  "entry",
  "exit",
  "entry.alt",
  "exit_1",
  "*origin",
  "top_alt",
  "_top_alt",
  "top__2",
  "a_b_c",
  "_a_b",
  "top_+2",
  "",
  "LSB",
  "_top.case",
  "top_01",
];

describe("anchor names read as export reads them", () => {
  it("for every kind of name", () => {
    const reference = createBridge().anchorKinds(NAMES);

    for (const [index, name] of NAMES.entries()) {
      const { kind, group, index: number } = reference[index]!;
      const expected = {
        kind,
        ...(group === undefined || group === null ? {} : { group }),
        ...(number === undefined || number === null ? {} : { index: number }),
      };
      expect.soft(anchorKind(name), JSON.stringify(name)).toEqual(expected);
    }
  });
});
