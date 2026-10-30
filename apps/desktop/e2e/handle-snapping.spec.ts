import { workspaceTest as test, expect } from "./fixtures/electronApp";
import { openScratchGlyph, SMOOTH_JOIN_CONTOUR } from "./fixtures/scratchGlyph";
import { localPoint, screenPoint, type ScreenPoint } from "@shift/editor/spaces";

// Geometry, guides, and mouseup modifier reporting are owned by SelectHandleSnap.test.ts.
// This test keeps the browser-only ordering: Shift keyup arrives before mouseup.
test("keeps a 15-degree handle snap when Shift is released before mouseup", async ({
  page,
  editor,
}) => {
  await openScratchGlyph(editor, "snapHandles", [SMOOTH_JOIN_CONTOUR]);

  const canvas = editor.canvas;
  const bounds = await editor.canvasBounds();
  // Drag the first segment's outgoing handle toward (180, 160), in whole canvas pixels. A
  // Shift-constrained drag leaves it snapped to 30 degrees around the segment's start, at the
  // dragged length.
  const [start, handle] = (await editor.drawnOutline())[0]!.points;
  const round = ({ x, y }: ScreenPoint) => screenPoint(Math.round(x), Math.round(y));
  const down = round(await editor.projectGlyphToCanvas(localPoint(handle!.x, handle!.y)));
  const end = round(await editor.projectGlyphToCanvas(localPoint(180, 160)));
  const [downGlyph, endGlyph] = await Promise.all([
    editor.projectCanvasToGlyph(down),
    editor.projectCanvasToGlyph(end),
  ]);
  const length = Math.hypot(
    handle!.x + endGlyph.x - downGlyph.x - start!.x,
    handle!.y + endGlyph.y - downGlyph.y - start!.y,
  );
  const drag = {
    id: handle!.id,
    pivot: start!.id,
    down,
    end,
    expected: {
      x: start!.x + length * Math.cos(Math.PI / 6),
      y: start!.y + length * Math.sin(Math.PI / 6),
    },
  };
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
    const preview = (await editor.drawnPoint(drag.id))!;
    expect(preview.x).toBeCloseTo(drag.expected.x, 4);
    expect(preview.y).toBeCloseTo(drag.expected.y, 4);
    expect(await editor.drawnPoint(drag.pivot)).toMatchObject({ x: 100, y: 100 });
    await expect
      .poll(() => editor.drawnSnapGuides())
      .toEqual([expect.objectContaining({ kind: "direction" })]);
    await page.keyboard.up("Shift");
    await editor.pointerUp();
    expect(await editor.point(drag.id)).toMatchObject({ x: preview.x, y: preview.y });
    await expect(editor.shell).toHaveAttribute("data-gesture", "idle");
    expect(await editor.drawnSnapGuides()).toEqual([]);
  } finally {
    await page.mouse.up();
    await page.keyboard.up("Shift");
  }
});
