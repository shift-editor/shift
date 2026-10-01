import { workspaceTest as test, expect } from "./fixtures/electronApp";
import { openScratchGlyph } from "./fixtures/scratchGlyph";
import { activeSnapGuides } from "./fixtures/snapGuides";

// Geometry, guides, and mouseup modifier reporting are owned by PenSnap.test.ts.
// This test keeps the browser-only ordering: Shift keyup arrives before mouseup.
test("keeps snapped Pen creation handles when Shift is released before mouseup", async ({
  page,
  editor,
}) => {
  await openScratchGlyph(page, editor, "snapPen");
  const canvas = editor.canvas;
  const bounds = await editor.canvasBounds();
  const first = { x: Math.round(bounds.width / 4), y: Math.round(bounds.height / 2) };
  const down = { x: Math.round(bounds.width / 2), y: first.y };
  const end = { x: down.x + 80, y: down.y - 60 };
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
  const expected = await page.evaluate(
    ({ down, end }) => {
      const editor = window.shift!.editor;
      const node = editor.scene.nodesOfKind("glyph")[0]!;
      const anchor = editor.projectScreenToScene(down);
      const pointer = editor.projectScreenToScene(end);
      const length = Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y);
      anchor.x -= node.position.x;
      anchor.y -= node.position.y;
      return {
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
    },
    { down, end },
  );
  const points = () =>
    page.evaluate(() => {
      const editor = window.shift!.editor;
      const node = editor.scene.nodesOfKind("glyph")[0]!;
      const layer = editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!;
      return layer.allPoints.map((point) => ({ id: point.id, x: point.x, y: point.y }));
    });
  expect(await points()).toHaveLength(1);
  await page.keyboard.down("Shift");
  await editor.pointerDown({ x: bounds.x + down.x, y: bounds.y + down.y });
  try {
    await editor.pointerMove({ x: bounds.x + end.x, y: bounds.y + end.y });
    const preview = await points();
    expect(preview).toHaveLength(4);
    expect(preview[2]!.x).toBeCloseTo(expected.incoming.x, 4);
    expect(preview[2]!.y).toBeCloseTo(expected.incoming.y, 4);
    expect(preview[3]!.x).toBeCloseTo(expected.anchor.x, 4);
    expect(preview[3]!.y).toBeCloseTo(expected.anchor.y, 4);
    const handle = await page.evaluate(() => {
      const state = window.shift!.editor.toolIf("pen")?.state;
      if (state?.type !== "dragging") throw new Error("Expected Pen drag");
      return state.curve.handlePosition;
    });
    expect(handle.x).toBeCloseTo(expected.outgoing.x, 4);
    expect(handle.y).toBeCloseTo(expected.outgoing.y, 4);
    await expect
      .poll(() => activeSnapGuides(page))
      .toEqual([expect.objectContaining({ kind: "direction" })]);
    await page.keyboard.up("Shift");
    await editor.pointerUp();
    expect(await points()).toEqual(preview);
    await expect(editor.shell).toHaveAttribute("data-gesture", "idle");
    expect(await activeSnapGuides(page)).toEqual([]);
  } finally {
    await page.mouse.up();
    await page.keyboard.up("Shift");
  }
});
