import { describe, it, expect, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

// Restored from the WS6 behavioral inventory (git show ef037c6e^); asserts
// confirmed (folded) geometry rather than the deleted currentGlyph getter.
describe("Shape tool", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("shape");
  });

  const contours = () => editor.activeGlyphSource?.geometry.contours ?? [];

  it("drag then release commits a closed 4-point rectangle contour", async () => {
    const contoursBefore = contours().length;

    editor.pointerDown(10, 10);
    editor.pointerMove(50, 30); // crosses drag threshold
    editor.pointerMove(110, 90);
    editor.pointerUp(110, 90);
    await editor.settle();

    const all = contours();
    expect(all.length).toBe(contoursBefore + 1);

    const created = all[all.length - 1]!;
    expect(created.points.length).toBe(4);
    expect(created.closed).toBe(true);
  });

  it("escape mid-drag discards the preview without committing a contour", async () => {
    const contoursBefore = contours().length;

    editor.pointerDown(10, 10);
    editor.pointerMove(50, 30);
    editor.pointerMove(110, 90);
    editor.escape();
    await editor.settle();

    expect(contours().length).toBe(contoursBefore);
    const state = editor.getActiveToolState();
    expect(state.type).toBe("ready");
  });

  it("drag smaller than the 3-unit minimum does not commit", async () => {
    const contoursBefore = contours().length;

    editor.pointerDown(10, 10);
    editor.pointerMove(14, 14);
    editor.pointerMove(12, 12);
    editor.pointerUp(12, 12);
    await editor.settle();

    expect(contours().length).toBe(contoursBefore);
  });

  it("a committed rectangle is one undo step", async () => {
    editor.pointerDown(10, 10);
    editor.pointerMove(50, 30); // crosses drag threshold
    editor.pointerMove(110, 90);
    editor.pointerUp(110, 90);
    await editor.settle();
    expect(contours().length).toBe(1);

    await editor.undoAndSettle();
    expect(contours().length).toBe(0);
  });
});
