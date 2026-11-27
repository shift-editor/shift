import { describe, expect, it } from "vitest";
import { rect } from "@/testing/fixtures";
import { useTestEditor, WEIGHT } from "@/testing/fontFixture";

// The variable-font variant of the Pen-on-instance report (2026-11-23): a
// two-source font, so the opened composite is drawn through source
// projection rather than a single authored layer.
describe("pen on a component-only glyph in a variable font", () => {
  const editor = useTestEditor({
    axes: [WEIGHT],
    sources: { Bold: { wght: 700 } },
    glyphs: {
      base: { outline: { advance: 600, contours: [rect(0, 0, 160, 160)] } },
      comp: { outline: { advance: 600, components: [{ glyph: "base", x: 50 }] } },
    },
    open: "comp",
  });

  it("keeps the component visible after the first pen click", async () => {
    await editor.openGlyph("comp");
    await editor.settle();

    editor.selectTool("pen");
    await editor.clickAt({ x: 300, y: 300 });

    expect(editor.drawnOutline()).toHaveLength(1);
    expect(editor.drawnHandles()).toHaveLength(1);
    expect((await editor.drawnGlyph("comp")).components).toHaveLength(1);
  });
});
