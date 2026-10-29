import { describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor({ file: FONTS.anchorPropagation, glyph: "a" });

describe("composites show their components' anchors", () => {
  it("stacks marks and takes the base's other anchors", async () => {
    expect((await editor.drawnGlyph("adotbelowacutetilde")).anchors).toEqual([
      { name: "top", x: 250, y: 850 },
      { name: "bottom", x: 250, y: -150 },
      { name: "ogonek", x: 420, y: 0 },
    ]);
  });

  it("swaps top and bottom through a vertically flipped component", async () => {
    expect((await editor.drawnGlyph("a.flip")).anchors).toEqual([
      { name: "bottom", x: 250, y: 0 },
      { name: "top", x: 250, y: 500 },
      { name: "ogonek", x: 420, y: 500 },
    ]);
  });

  it("lets a later component's anchor replace an earlier one's", async () => {
    expect((await editor.drawnGlyph("f_i")).anchors).toEqual([
      { name: "top", x: 425, y: 500 },
      { name: "bottom", x: 425, y: 0 },
    ]);
  });
});
