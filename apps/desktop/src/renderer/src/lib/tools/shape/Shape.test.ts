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

  const contours = () => editor.glyphLayer?.geometry.contours ?? [];

  it("publishes lifecycle state through the typed tool surface", () => {
    expect(editor.toolIf("shape")?.state).toEqual({ type: "ready" });

    editor.selectTool("select");

    expect(editor.toolIf("shape")).toBeNull();
    expect(editor.toolIf("select")?.state).toEqual({ type: "ready" });
  });

  it("drag then release commits a closed 4-point rectangle contour", async () => {
    const contoursBefore = contours().length;

    await editor.dragScene({
      down: { x: 10, y: 10 },
      start: { x: 50, y: 30 },
      end: { x: 110, y: 90 },
    });

    const all = contours();
    expect(all.length).toBe(contoursBefore + 1);

    const created = all[all.length - 1]!;
    expect(created.points.length).toBe(4);
    expect(created.closed).toBe(true);
  });

  it("selects the committed rectangle and returns to the Select tool", async () => {
    await editor.dragScene({
      down: { x: 10, y: 10 },
      start: { x: 50, y: 30 },
      end: { x: 110, y: 90 },
    });

    const created = contours().at(-1);
    expect(editor.selection.ids).toEqual([created?.id]);
    expect(editor.toolIf("select")?.state).toEqual({ type: "ready" });
  });

  it("escape mid-drag discards the preview without committing a contour", () => {
    const contoursBefore = contours().length;

    editor.pointerDown(10, 10);
    editor.pointerMove(50, 30);
    editor.pointerMove(110, 90);
    editor.escape();

    expect(contours().length).toBe(contoursBefore);
    expect(editor.toolIf("shape")?.state.type).toBe("ready");
  });

  it("drag smaller than the 3-unit minimum does not commit", () => {
    const contoursBefore = contours().length;

    editor.pointerDown(10, 10);
    editor.pointerMove(14, 14);
    editor.pointerMove(12, 12);
    editor.pointerUp(12, 12);

    expect(contours().length).toBe(contoursBefore);
  });

  it("a committed rectangle is one undo step", async () => {
    await editor.dragScene({
      down: { x: 10, y: 10 },
      start: { x: 50, y: 30 },
      end: { x: 110, y: 90 },
    });
    expect(contours().length).toBe(1);

    await editor.undo();
    expect(contours().length).toBe(0);
  });
});
