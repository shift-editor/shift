import { describe, expect, it } from "vitest";
import { Point } from "@shift/glyph-state";
import { TestEditor } from "@/testing/TestEditor";

describe("snapping crosses the corners of every contour's box", () => {
  it("returns each contour's bounds corners and any extra box", async () => {
    const editor = new TestEditor();
    await editor.startSession();
    const layer = editor.requireGlyphLayer();
    const contourId = layer.addContour();
    for (const point of [
      { x: 100, y: 0 },
      { x: 200, y: 50 },
      { x: 150, y: 120 },
    ]) {
      layer.addPoint(contourId, Point.onCurve(point));
    }
    layer.closeContour(contourId);
    await editor.settle();

    const crossings = editor.snapping.crossings(layer, [
      { min: { x: 0, y: 0 }, max: { x: 10, y: 10 } },
    ]);

    expect(crossings).toEqual([
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 120 },
      { x: 100, y: 120 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });
});
