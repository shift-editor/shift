import { describe, expect, it } from "vitest";
import { byName } from "@shift/types";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

const editor = useTestEditor({ file: FONTS.anchorPropagation, glyph: "a" });

async function shownAnchors(glyph: string) {
  return [...(await editor.drawnGlyph(glyph)).anchors].sort(byName);
}

describe("composites show their components' anchors", () => {
  it("stacks marks and takes the base's other anchors", async () => {
    expect(await shownAnchors("adotbelowacutetilde")).toEqual([
      { name: "bottom", x: 250, y: -150 },
      { name: "ogonek", x: 420, y: 0 },
      { name: "top", x: 250, y: 850 },
    ]);
  });

  it("swaps top and bottom through a vertically flipped component", async () => {
    expect(await shownAnchors("a.flip")).toEqual([
      { name: "bottom", x: 250, y: 0 },
      { name: "ogonek", x: 420, y: 500 },
      { name: "top", x: 250, y: 500 },
    ]);
  });

  it("lets a later component's anchor replace an earlier one's", async () => {
    expect(await shownAnchors("f_i")).toEqual([
      { name: "bottom", x: 425, y: 0 },
      { name: "top", x: 425, y: 500 },
    ]);
  });
});
