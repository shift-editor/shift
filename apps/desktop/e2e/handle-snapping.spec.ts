import { workspaceTest as test, expect } from "./fixtures/electronApp";
import { openScratchGlyph } from "./fixtures/scratchGlyph";
import { activeSnapGuides } from "./fixtures/snapGuides";

// Geometry, guides, and mouseup modifier reporting are owned by SelectHandleSnap.test.ts.
// This test keeps the browser-only ordering: Shift keyup arrives before mouseup.
test("keeps a 15-degree handle snap when Shift is released before mouseup", async ({
  page,
  editor,
}) => {
  await openScratchGlyph(page, editor, "snapHandles", [
    {
      closed: false,
      points: [
        { x: 100, y: 100, pointType: "onCurve", smooth: false },
        { x: 200, y: 100, pointType: "offCurve", smooth: false },
        { x: 300, y: 100, pointType: "offCurve", smooth: false },
        { x: 400, y: 100, pointType: "onCurve", smooth: true },
        { x: 500, y: 100, pointType: "offCurve", smooth: false },
        { x: 600, y: 100, pointType: "offCurve", smooth: false },
        { x: 700, y: 100, pointType: "onCurve", smooth: false },
      ],
    },
  ]);

  const canvas = editor.canvas;
  const bounds = await editor.canvasBounds();
  const drag = await page.evaluate(() => {
    const editor = window.shift!.editor;
    const node = editor.scene.nodesOfKind("glyph")[0]!;
    const layer = editor.glyphForId(node.glyphId)!.layerForSource(node.sourceId)!;
    const cubic = layer.contours[0]!.segments()[0]!.asCubic()!;
    const down = editor.projectSceneToScreen({
      x: cubic.controlStart.x + node.position.x,
      y: cubic.controlStart.y + node.position.y,
    });
    const end = editor.projectSceneToScreen({
      x: 180 + node.position.x,
      y: 160 + node.position.y,
    });
    down.x = Math.round(down.x);
    down.y = Math.round(down.y);
    end.x = Math.round(end.x);
    end.y = Math.round(end.y);
    const startPos = editor.projectScreenToScene(down);
    const endPos = editor.projectScreenToScene(end);
    const length = Math.hypot(
      cubic.controlStart.x + endPos.x - startPos.x - cubic.start.x,
      cubic.controlStart.y + endPos.y - startPos.y - cubic.start.y,
    );
    return {
      id: cubic.controlStart.id,
      pivot: cubic.start.id,
      down,
      end,
      expected: {
        x: cubic.start.x + length * Math.cos(Math.PI / 6),
        y: cubic.start.y + length * Math.sin(Math.PI / 6),
      },
    };
  });
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
