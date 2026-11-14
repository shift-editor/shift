import { describe, expect, it } from "vitest";
import type { GlyphId } from "@shift/types";
import { tagTargetsOf } from "./tagTargets";

const [a, b, shown] = ["a", "b", "shown"] as GlyphId[] as [GlyphId, GlyphId, GlyphId];

describe("the glyphs a colour is given to", () => {
  it("are the grid's selection on the font overview", () => {
    expect(tagTargetsOf("/home", [a, b], shown)).toEqual([a, b]);
  });

  it("are the glyph the canvas shows when the overview has nothing selected", () => {
    expect(tagTargetsOf("/home", [], shown)).toEqual([shown]);
    expect(tagTargetsOf("/home", [], null)).toEqual([]);
  });

  it("are the glyph the canvas shows anywhere else, whatever the grid has selected", () => {
    expect(tagTargetsOf("/editor/shown", [a, b], shown)).toEqual([shown]);
  });
});
