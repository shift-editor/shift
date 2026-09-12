import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Point } from "@shift/glyph-state";
import { TestEditor } from "@/testing/TestEditor";

let editor: TestEditor;
beforeEach(async () => {
  editor = new TestEditor();
  await editor.startSession();
});
afterEach(async () => {
  await editor.settle();
  editor.destroy();
});

describe("workspace confirmation preserves unchanged live geometry", () => {
  it("keeps the local geometry when structural edits receive identical echoes", async () => {
    const layer = editor.requireGlyphLayer();
    const contourId = layer.addContour();
    const ids = layer.addPoints(contourId, [
      Point.onCurve({ x: 100, y: 200 }),
      Point.onCurve({ x: 300, y: 200 }),
    ]);
    const geometry = layer.geometry;
    await editor.settle();
    expect(layer.geometry).toBe(geometry);
    expect(layer.contours[0]!.points.map((point) => point.id)).toEqual(ids);
  });

  it("keeps newer local positions while multiple FIFO confirmations drain", async () => {
    const layer = editor.requireGlyphLayer();
    const contourId = layer.addContour();
    const ids = layer.addPoints(contourId, [Point.onCurve({ x: 100, y: 200 })]);
    await editor.settle();
    layer.movePoints(ids, { x: 10, y: 20 });
    layer.movePoints(ids, { x: 30, y: 40 });
    const geometry = layer.geometry;
    await editor.settle();
    expect(layer.geometry).toBe(geometry);
    expect(layer.point(ids[0]!)).toMatchObject({ x: 140, y: 260 });
  });

  it("still publishes authoritative value changes through undo and redo", async () => {
    const layer = editor.requireGlyphLayer();
    const contourId = layer.addContour();
    const ids = layer.addPoints(contourId, [Point.onCurve({ x: 100, y: 200 })]);
    await editor.settle();
    layer.movePoints(ids, { x: 10, y: 20 });
    await editor.settle();
    await editor.undo();
    expect(layer.point(ids[0]!)).toMatchObject({ x: 100, y: 200 });
    await editor.redo();
    expect(layer.point(ids[0]!)).toMatchObject({ x: 110, y: 220 });
  });
});
