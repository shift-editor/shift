import { workspaceTest as test, expect } from "./fixtures/electronApp";
import { handleSnapDrag } from "./fixtures/editorInteractions";
import { openScratchGlyph, SMOOTH_JOIN_CONTOUR } from "./fixtures/scratchGlyph";
import { activeSnapGuides } from "./fixtures/snapGuides";

// Geometry, guides, and mouseup modifier reporting are owned by SelectHandleSnap.test.ts.
// This test keeps the browser-only ordering: Shift keyup arrives before mouseup.
test("keeps a 15-degree handle snap when Shift is released before mouseup", async ({
  page,
  editor,
}) => {
  await openScratchGlyph(page, editor, "snapHandles", [SMOOTH_JOIN_CONTOUR]);

  const canvas = editor.canvas;
  const bounds = await editor.canvasBounds();
  const drag = await handleSnapDrag(page);
  for (const point of [drag.down, drag.end]) {
    expect(point.x).toBeGreaterThan(0);
    expect(point.y).toBeGreaterThan(0);
    expect(point.x).toBeLessThan(bounds.width);
    expect(point.y).toBeLessThan(bounds.height);
  }
  await canvas.click({ position: drag.down });
  await page.keyboard.down("Shift");
  await editor.pointerDown({ x: bounds.x + drag.down.x, y: bounds.y + drag.down.y });
  try {
    await editor.pointerMove({ x: bounds.x + drag.end.x, y: bounds.y + drag.end.y }, 3);
    const preview = await editor.livePointPosition(drag.id);
    expect(preview.x).toBeCloseTo(drag.expected.x, 4);
    expect(preview.y).toBeCloseTo(drag.expected.y, 4);
    expect(await editor.livePointPosition(drag.pivot)).toEqual({ x: 100, y: 100 });
    await expect
      .poll(() => activeSnapGuides(page))
      .toEqual([expect.objectContaining({ kind: "direction" })]);
    await page.keyboard.up("Shift");
    await editor.pointerUp();
    expect(await editor.pointPosition(drag.id)).toEqual(preview);
    await expect(editor.shell).toHaveAttribute("data-gesture", "idle");
    expect(await activeSnapGuides(page)).toEqual([]);
  } finally {
    await page.mouse.up();
    await page.keyboard.up("Shift");
  }
});
