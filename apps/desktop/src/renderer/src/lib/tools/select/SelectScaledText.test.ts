import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { localPoint } from "@shift/editor/spaces";
import { TestEditor } from "@/testing/TestEditor";

describe("a glyph edited inside text takes the text's size", () => {
  let editor: TestEditor;
  let firstId: PointId;
  let middleId: PointId;
  let lastId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    [firstId, middleId, lastId] = (await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 300, y: 300 },
      { x: 500, y: 100 },
    ])) as [PointId, PointId, PointId];
    editor.selectTool("select");
    editor.selection.clear();
    const run = editor.textRun!;
    editor.scene.updateNode({ id: run.id, size: run.size / 10 });
  });

  it("draws a tenth as large in text set at a tenth of the font's size", () => {
    const node = editor.runGlyph!;
    const origin = editor.toScene(node, localPoint(0, 0));
    const em = editor.toScene(node, localPoint(1000, 0));

    expect(em.x - origin.x).toBeCloseTo(100);
  });

  it("hits a point within the on-screen radius, measured in the glyph's own units", async () => {
    const node = editor.runGlyph!;
    const radius = editor.hitRadiusIn(node);
    expect(radius).toBeCloseTo(editor.hitRadius * 10);

    await editor.clickLocal(300 + radius / 2, 300);

    expect(editor.selection.has(middleId)).toBe(true);
  });

  it("snaps a dragged point to a metric within the on-screen radius", async () => {
    const node = editor.runGlyph!;
    const metrics = editor.font.metricsForSource(editor.requireGlyphLayer().sourceId);
    if (metrics.xHeight === undefined) throw new Error("Expected the test font to author x-height");
    const xHeight = metrics.xHeight;
    // Beyond the radius at the font's own size, within it at a tenth of the size.
    const near = xHeight - editor.hitRadiusIn(node) / 2;
    expect(xHeight - near).toBeGreaterThan(editor.hitRadius);

    await editor.dragLocal({
      down: { x: 300, y: 300 },
      start: { x: 300, y: near },
      end: { x: 300, y: near },
    });

    expect(editor.pointPosition(middleId)).toEqual({ x: 300, y: xHeight });
  });

  it("closes a contour when its end drops within the on-screen radius of its start", async () => {
    const node = editor.runGlyph!;
    const gap = editor.hitRadiusIn(node) / 2;
    expect(gap).toBeGreaterThan(editor.hitRadius);

    await editor.dragLocal({
      down: editor.pointPosition(lastId),
      start: { x: 480, y: 120 },
      end: { x: 100 + gap, y: 100 + gap },
    });

    const contour = editor.glyphContours[0];
    expect(contour?.closed).toBe(true);
    expect(contour?.points.map((point) => point.id)).toEqual([firstId, middleId]);
  });
});
