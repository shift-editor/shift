import { describe, expect, it } from "vitest";
import { anchorKind } from "@shift/wasm";

describe("anchorKind", () => {
  it("tells marks, bases, ligatures, carets, and cursive anchors apart", () => {
    expect(anchorKind("_top")).toEqual({ kind: "mark", group: "top" });
    expect(anchorKind("top")).toEqual({ kind: "base", group: "top" });
    expect(anchorKind("top_2")).toEqual({ kind: "ligature", group: "top", index: 2 });
    expect(anchorKind("caret_1")).toEqual({ kind: "caret", index: 1 });
    expect(anchorKind("exit")).toEqual({ kind: "exit" });
    expect(anchorKind("_top_1")).toEqual({ kind: "invalid" });
  });
});
