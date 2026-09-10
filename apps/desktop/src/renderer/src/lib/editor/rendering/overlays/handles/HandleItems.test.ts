import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import { HandleItems } from "./HandleItems";

let editor: TestEditor;
beforeEach(async () => {
  editor = new TestEditor();
  await editor.startSession();
  editor.selectTool("pen");
});
afterEach(async () => {
  await editor.settle();
  editor.destroy();
});

describe("handle culling preserves authored neighbors and visibility", () => {
  it("does not turn a viewport's first visible point into a contour endpoint", async () => {
    await editor.clickGlyphLocal(100, 100);
    await editor.clickGlyphLocal(200, 150);
    await editor.clickGlyphLocal(300, 100);
    const contours = editor.requireGlyphLayer().contours;
    const list = new HandleItems().fromContours(contours, editor, undefined, {
      min: { x: 190, y: 140 },
      max: { x: 210, y: 160 },
    });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.point.id).toBe(contours[0]!.points[1]!.id);
    expect(list.items[0]!.shape).toBe("corner");
    expect(list.items[0]!.prev?.id).toBe(contours[0]!.points[0]!.id);
    expect(list.items[0]!.next?.id).toBe(contours[0]!.points[2]!.id);
  });

  it("keeps boundary endpoints and their direction toward offscreen neighbors", async () => {
    await editor.clickGlyphLocal(100, 100);
    await editor.clickGlyphLocal(200, 200);
    const contours = editor.requireGlyphLayer().contours;
    const list = new HandleItems().fromContours(contours, editor, undefined, {
      min: { x: 100, y: 100 },
      max: { x: 110, y: 110 },
    });
    expect(list.items).toHaveLength(1);
    expect(list.items[0]!.shape).toBe("first");
    expect(list.items[0]!.rotation).toBeCloseTo(Math.PI / 4);
  });

  it("restores culled markers after the viewport moves without changing the glyph", async () => {
    await editor.clickGlyphLocal(100, 100);
    const layer = editor.requireGlyphLayer();
    const geometry = layer.geometry;
    const items = new HandleItems();
    expect(
      items.fromContours(layer.contours, editor, undefined, {
        min: { x: 200, y: 200 },
        max: { x: 300, y: 300 },
      }).items,
    ).toEqual([]);
    expect(
      items
        .fromContours(layer.contours, editor, undefined, {
          min: { x: 0, y: 0 },
          max: { x: 200, y: 200 },
        })
        .items.map((item) => item.point.id),
    ).toEqual(layer.allPoints.map((point) => point.id));
    expect(layer.geometry).toBe(geometry);
  });

  it("continues to exclude explicitly hidden markers inside the viewport", async () => {
    await editor.clickGlyphLocal(100, 100);
    const layer = editor.requireGlyphLayer();
    const id = layer.allPoints[0]!.id;
    const release = editor.hideHandles(id);
    try {
      const list = new HandleItems().fromContours(
        layer.contours,
        editor,
        (pointId, contourId) => editor.handlesVisible(pointId, contourId),
        { min: { x: 0, y: 0 }, max: { x: 200, y: 200 } },
      );
      expect(list.items).toEqual([]);
      expect(layer.point(id)).toMatchObject({ x: 100, y: 100 });
    } finally {
      release();
    }
  });
});
