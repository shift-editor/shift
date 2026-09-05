import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Point } from "@shift/glyph-state";
import { TestEditor } from "@/testing/TestEditor";

let editor: TestEditor;
const layer = () => editor.requireGlyphLayer();

beforeEach(async () => {
  editor = new TestEditor();
  await editor.startSession();
});
afterEach(() => editor.destroy());

describe("point deletion never increases the original span's degree", () => {
  it.each([0, 100])("joins line endpoints without controls across a corner at y=%s", async (y) => {
    const ids = await editor.drawOpenContour([
      { x: 0, y: 0 },
      { x: 100, y },
      { x: 200, y: 0 },
    ]);
    const before = layer().state;
    editor.selection.select([ids[1]]);
    await editor.deleteSelection();
    const after = layer().state;
    expect(
      layer()
        .contours[0].segments()
        .map((segment) => segment.type),
    ).toEqual(["line"]);
    expect(layer().allPoints.map((point) => point.id)).toEqual([ids[0], ids[2]]);
    expect(layer().allPoints.map(({ x, y, smooth }) => ({ x, y, smooth }))).toEqual([
      { x: 0, y: 0, smooth: false },
      { x: 200, y: 0, smooth: false },
    ]);
    await editor.undo();
    expect(layer().state).toEqual(before);
    await editor.redo();
    expect(layer().state).toEqual(after);
  });

  it("keeps an untouched cubic while joining a neighboring line-only span", async () => {
    const ids = await editor.drawOpenContour([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 0 },
      { x: 300, y: 0 },
    ]);
    layer().upgradeLineToCubic(layer().contours[0].segments()[2].id);
    await editor.settle();
    const untouched = layer().contours[0].segments()[2];
    editor.selection.select([ids[1]]);
    await editor.deleteSelection();
    expect(
      layer()
        .contours[0].segments()
        .map((segment) => segment.type),
    ).toEqual(["line", "cubic"]);
    expect(layer().contours[0].segments()[1].toCurve()).toEqual(untouched.toCurve());
    expect(layer().contours[0].segments()[1].pointIds).toEqual(untouched.pointIds);
  });

  it("still fits a cubic when the removed span mixes a line and a cubic", async () => {
    const ids = await editor.drawOpenContour([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 0 },
    ]);
    layer().upgradeLineToCubic(layer().contours[0].segments()[1].id);
    await editor.settle();
    editor.selection.select([ids[1]]);
    await editor.deleteSelection();
    expect(
      layer()
        .contours[0].segments()
        .map((segment) => segment.type),
    ).toEqual(["cubic"]);
    expect(
      layer()
        .allPoints.filter(Point.isOnCurve)
        .map((point) => point.id),
    ).toEqual([ids[0], ids[2]]);
  });

  it.each(["line", "quad", "cubic"] as const)(
    "keeps the maximum degree when joining a quadratic to a %s",
    async (type) => {
      await editor.drawOpenContour([{ x: 0, y: 0 }]);
      const contour = layer().contours[0].id;
      layer().addPoint(contour, Point.offCurve({ x: 50, y: 100 }));
      const selected = layer().addPoint(contour, Point.create({ x: 100, y: 100 }, "qCurve"));
      const end = layer().addPoint(contour, Point.create({ x: 200, y: 0 }, "qCurve"));
      if (type === "quad") layer().insertPointBefore(end, Point.offCurve({ x: 150, y: 100 }));
      if (type === "cubic") layer().upgradeLineToCubic(layer().contours[0].segments()[1].id);
      await editor.settle();
      const before = layer().state;
      const endpoints = [layer().allPoints[0].id, end];
      editor.selection.select([selected]);
      await editor.deleteSelection();
      const after = layer().state;
      expect(
        layer()
          .contours[0].segments()
          .map((segment) => segment.type),
      ).toEqual([type === "cubic" ? "cubic" : "quad"]);
      expect(
        layer()
          .allPoints.filter(Point.isOnCurve)
          .map((point) => point.id),
      ).toEqual(endpoints);
      expect(layer().pointCount).toBe(type === "cubic" ? 4 : 3);
      await editor.undo();
      expect(layer().state).toEqual(before);
      await editor.redo();
      expect(layer().state).toEqual(after);
    },
  );
});
