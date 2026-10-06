import { beforeEach, describe, expect, it } from "vitest";
import { Point } from "@shift/glyph-state";
import { TestEditor } from "@/testing/TestEditor";

describe("Pen snaps new points to metrics and existing points", () => {
  let editor: TestEditor;
  let xHeight: number;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    const metrics = editor.font.metricsForSource(editor.requireGlyphLayer().sourceId);
    if (metrics.xHeight === undefined) throw new Error("Expected the test font to author x-height");
    xHeight = metrics.xHeight;
    editor.selectTool("pen");
  });

  it("snaps the first point of a contour to a metric", async () => {
    await editor.clickLocal(200, xHeight - editor.hitRadius / 2);

    expect(editor.requireGlyphLayer().allPoints[0]).toMatchObject({ x: 200, y: xHeight });
  });

  it("lines a new point up with an earlier one", async () => {
    await editor.clickLocal(100, 120);
    await editor.clickLocal(300, 120 + editor.hitRadius / 2);

    expect(editor.requireGlyphLayer().allPoints[1]).toMatchObject({ x: 300, y: 120 });
  });

  it("places the point exactly where clicked while Cmd is held", async () => {
    const near = xHeight - editor.hitRadius / 2;
    await editor.clickLocal(200, near, { metaKey: true });

    expect(editor.requireGlyphLayer().allPoints[0]).toMatchObject({ x: 200, y: near });
  });

  it("lands a new point exactly on a nearby point instead of splitting its segment", async () => {
    const layer = editor.requireGlyphLayer();
    const contourId = layer.addContour();
    for (const corner of [
      { x: 100, y: 100 },
      { x: 100, y: 300 },
      { x: 300, y: 300 },
      { x: 300, y: 100 },
    ]) {
      layer.addPoint(contourId, Point.onCurve(corner));
    }
    layer.closeContour(contourId);
    await editor.settle();
    const near = editor.hitRadius / 3;

    await editor.clickLocal(300 - near, 300 - near);

    expect(layer.contours[0]!.points).toHaveLength(4);
    expect(layer.contours[1]!.points[0]).toMatchObject({ x: 300, y: 300 });
  });
});
