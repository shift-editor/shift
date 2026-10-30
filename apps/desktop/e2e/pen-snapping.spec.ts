import { workspaceTest as test, expect } from "./fixtures/electronApp";
import { openScratchGlyph } from "./fixtures/scratchGlyph";
import { screenPoint } from "@shift/editor/spaces";

// Geometry, guides, and mouseup modifier reporting are owned by PenSnap.test.ts.
// This test keeps the browser-only ordering: Shift keyup arrives before mouseup.
test("keeps snapped Pen creation handles when Shift is released before mouseup", async ({
  page,
  editor,
}) => {
  await openScratchGlyph(editor, "snapPen");
  const canvas = editor.canvas;
  const bounds = await editor.canvasBounds();
  const first = screenPoint(Math.round(bounds.width / 4), Math.round(bounds.height / 2));
  const down = screenPoint(Math.round(bounds.width / 2), first.y);
  const end = screenPoint(down.x + 80, down.y - 60);
  for (const point of [first, down, end]) {
    expect(point.x).toBeGreaterThan(0);
    expect(point.y).toBeGreaterThan(0);
    expect(point.x).toBeLessThan(bounds.width);
    expect(point.y).toBeLessThan(bounds.height);
  }
  await editor.selectTool("pen");
  await canvas.click({ position: first });
  await editor.waitForIdle();
  await expect.poll(() => editor.pointCount()).toBe(1);
  // A Shift-constrained drag from `down` to `end` leaves the anchor at `down` and snaps both
  // handles to 30 degrees, at the pointer's distance.
  const [anchor, pointer] = await Promise.all([
    editor.projectCanvasToGlyph(down),
    editor.projectCanvasToGlyph(end),
  ]);
  const length = Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y);
  const expected = {
    anchor,
    incoming: {
      x: anchor.x - length * Math.cos(Math.PI / 6),
      y: anchor.y - length * Math.sin(Math.PI / 6),
    },
    outgoing: {
      x: anchor.x + length * Math.cos(Math.PI / 6),
      y: anchor.y + length * Math.sin(Math.PI / 6),
    },
  };
  const points = async () => (await editor.drawnOutline()).flatMap((contour) => contour.points);
  expect(await points()).toHaveLength(1);
  await page.keyboard.down("Shift");
  await editor.pointerDown({ x: bounds.x + down.x, y: bounds.y + down.y });
  try {
    await editor.pointerMove({ x: bounds.x + end.x, y: bounds.y + end.y });
    const preview = await points();
    expect(preview).toMatchObject([
      {},
      {},
      { x: expect.closeTo(expected.incoming.x, 4), y: expect.closeTo(expected.incoming.y, 4) },
      { x: expect.closeTo(expected.anchor.x, 4), y: expect.closeTo(expected.anchor.y, 4) },
    ]);
    expect(await editor.drawnPenHandle()).toMatchObject({
      x: expect.closeTo(expected.outgoing.x, 4),
      y: expect.closeTo(expected.outgoing.y, 4),
    });
    await expect
      .poll(() => editor.drawnSnapGuides())
      .toEqual([expect.objectContaining({ kind: "direction" })]);
    await page.keyboard.up("Shift");
    await editor.pointerUp();
    expect(await points()).toEqual(preview);
    await expect(editor.shell).toHaveAttribute("data-gesture", "idle");
    expect(await editor.drawnSnapGuides()).toEqual([]);
  } finally {
    await page.mouse.up();
    await page.keyboard.up("Shift");
  }
});
