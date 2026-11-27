import { describe, expect, it } from "vitest";
import { rect } from "@/testing/fixtures";
import { useTestEditor } from "@/testing/fontFixture";

// Reported (2026-11-23) in the real app: with a component-only glyph open,
// the first Pen click makes the component paths disappear and the new points
// do not show until switching to Select. The settled TestEditor surface does
// not reproduce that (its markers are the 2D fallback, not WebGL, and edits
// settle synchronously); these tests pin the state the canvas must hold
// while the Pen is active.
describe("pen on a component-only glyph", () => {
  const editor = useTestEditor({
    glyphs: {
      base: { outline: { advance: 600, contours: [rect(0, 0, 160, 160)] } },
      comp: { outline: { advance: 600, components: [{ glyph: "base", x: 50 }] } },
    },
    open: "comp",
  });

  it("keeps the component and shows the new points while the Pen is active", async () => {
    await editor.openGlyph("comp");
    editor.recordCanvas();
    editor.passFrame();
    const before = editor.latestCanvasFrame();

    editor.selectTool("pen");
    await editor.clickAt({ x: 300, y: 300 });
    editor.passFrame();

    expect(editor.drawnOutline()).toHaveLength(1);
    expect(editor.drawnHandles()).toHaveLength(1);
    expect((await editor.drawnGlyph("comp")).components).toHaveLength(1);

    await editor.clickAt({ x: 400, y: 300 });
    editor.passFrame();

    expect(editor.drawnOutline()).toHaveLength(1);
    expect(editor.drawnHandles()).toHaveLength(2);
    expect((await editor.drawnGlyph("comp")).components).toHaveLength(1);

    // A path the frame filled before the clicks is still filled after them.
    const after = editor.latestCanvasFrame();
    expect(after.fills.some((fill) => before.fills.includes(fill))).toBe(true);
  });
});
