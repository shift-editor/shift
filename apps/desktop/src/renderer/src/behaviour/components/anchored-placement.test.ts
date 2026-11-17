import { describe, expect, it } from "vitest";
import { FONTS, useTestEditor } from "@/testing/fontFixture";

// AnchorPropagation's `adotbelowacutetilde` stacks `tildecomb` on
// `acutecomb`'s `top`, which sits at y 700 in Light (weight 100, the default)
// and 730 in Bold (weight 900). In Light the acute is at dx 150, so the
// tilde's `_top` (y 500) lands at dy 200.
const editor = useTestEditor({ file: FONTS.anchorPropagation, glyph: "adotbelowacutetilde" });

async function drawnMarks() {
  const [, , acute, tilde] = (await editor.drawnGlyph()).components;
  return { acute: { dx: acute?.dx, dy: acute?.dy }, tilde: { dx: tilde?.dx, dy: tilde?.dy } };
}

describe("anchored components sit on anchors read where each glyph is drawn", () => {
  it("lifts the tilde onto the acute's bold top when the acute is drawn bold in Light", async () => {
    expect(await drawnMarks()).toEqual({ acute: { dx: 150, dy: 0 }, tilde: { dx: 130, dy: 200 } });

    const weight = editor.axis({ tag: "wght" })!;
    editor.selectObjects([(await editor.components())[2]!.id]);
    expect(await editor.setSelectedComponentsAxis(weight.id, 900)).toBe(true);

    // The acute's `_top` is the same in both masters, so it stays; its `top`
    // is drawn at 730, so the tilde follows it up.
    expect(await drawnMarks()).toEqual({ acute: { dx: 150, dy: 0 }, tilde: { dx: 130, dy: 230 } });
    // The glyph's `top` is the tilde's, propagated from where it is drawn.
    expect((await editor.drawnGlyph()).anchors).toContainEqual({ name: "top", x: 250, y: 880 });
  });
});
