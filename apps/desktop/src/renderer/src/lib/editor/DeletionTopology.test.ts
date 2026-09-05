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

describe("open contour deletion preserves surviving fragments", () => {
  beforeEach(async () => {
    await editor.drawOpenContour([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 100 },
      { x: 300, y: 0 },
      { x: 400, y: 0 },
    ]);
  });

  it("splits around a gap without connecting the two surviving runs", async () => {
    const original = layer().contours[0];
    const ids = original.points.map((point) => point.id);
    const before = layer().state;
    editor.selection.select([ids[2]]);
    await editor.deleteSelection("gap");
    expect(layer().contours.map((contour) => contour.points.map((point) => point.id))).toEqual([
      ids.slice(0, 2),
      ids.slice(3),
    ]);
    expect(layer().contours.map((contour) => contour.closed)).toEqual([false, false]);
    expect(layer().contours[0].id).toBe(original.id);
    const after = layer().state;
    await editor.undo();
    expect(layer().state).toEqual(before);
    await editor.redo();
    expect(layer().state).toEqual(after);
  });

  it("keeps disconnected deletion spans separate around a surviving point", async () => {
    const ids = layer().allPoints.map((point) => point.id);
    editor.selection.select([ids[1], ids[3]]);
    await editor.deleteSelection();
    expect(
      layer()
        .allPoints.filter(Point.isOnCurve)
        .map((point) => point.id),
    ).toEqual([ids[0], ids[2], ids[4]]);
    expect(
      layer()
        .contours[0].segments()
        .map((segment) => segment.type),
    ).toEqual(["cubic", "cubic"]);
  });

  it("keeps isolated surviving points between multiple gaps", async () => {
    const ids = layer().allPoints.map((point) => point.id);
    editor.selection.select([ids[1], ids[3]]);
    await editor.deleteSelection("gap");
    expect(layer().contours.map((contour) => contour.points.map((point) => point.id))).toEqual([
      [ids[0]],
      [ids[2]],
      [ids[4]],
    ]);
  });

  it.each(["fit", "gap"] as const)(
    "trims open endpoints without inventing a fit in %s mode",
    async (mode) => {
      const ids = layer().allPoints.map((point) => point.id);
      editor.selection.select([ids[0], ids[4]]);
      await editor.deleteSelection(mode);
      expect(layer().allPoints.map((point) => point.id)).toEqual(ids.slice(1, 4));
      expect(layer().contours[0].closed).toBe(false);
    },
  );

  it("does not change unrelated contours or their ordering", async () => {
    const selected = layer().allPoints[2].id;
    editor.escape();
    await editor.drawOpenContour([
      { x: 600, y: 0 },
      { x: 700, y: 0 },
    ]);
    const untouched = layer().contours[1];
    editor.selection.select([selected]);
    await editor.deleteSelection("gap");
    expect(layer().contours[1].id).toBe(untouched.id);
    expect(layer().contours[1].points.map((point) => point.id)).toEqual(
      untouched.points.map((point) => point.id),
    );
    expect(layer().contours[1].segments()[0].toCurve()).toEqual(untouched.segments()[0].toCurve());
  });
});

describe("closed contour deletion treats the array boundary cyclically", () => {
  beforeEach(async () => {
    await editor.drawOpenContour([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 100 },
      { x: 100, y: 200 },
      { x: 0, y: 100 },
    ]);
    layer().closeContour(layer().contours[0].id);
    await editor.settle();
  });

  it("fits a selected run crossing the stored start as one span", async () => {
    const ids = layer().allPoints.map((point) => point.id);
    editor.selection.select([ids[4], ids[0]]);
    await editor.deleteSelection();
    const contour = layer().contours[0];
    expect(contour.closed).toBe(true);
    expect(contour.points.filter(Point.isOnCurve).map((point) => point.id)).toEqual(
      ids.slice(1, 4),
    );
    expect(contour.segments().map((segment) => segment.type)).toEqual(["line", "line", "cubic"]);
    expect(contour.segments()[2].endId).toBe(ids[1]);
  });

  it("opens a contour around an interior gap without losing the wrapped run", async () => {
    const ids = layer().allPoints.map((point) => point.id);
    editor.selection.select([ids[2]]);
    await editor.deleteSelection("gap");
    expect(layer().contours).toHaveLength(1);
    expect(layer().contours[0].closed).toBe(false);
    expect(layer().allPoints.map((point) => point.id)).toEqual([ids[3], ids[4], ids[0], ids[1]]);
    expect(layer().contours[0].segments()).toHaveLength(3);
  });

  it("opens a gap across the stored start", async () => {
    const ids = layer().allPoints.map((point) => point.id);
    editor.selection.select([ids[4], ids[0]]);
    await editor.deleteSelection("gap");
    expect(layer().contours[0].closed).toBe(false);
    expect(layer().allPoints.map((point) => point.id)).toEqual(ids.slice(1, 4));
  });

  it("retains two surviving points as a closed contour with two fitted sides", async () => {
    const ids = layer().allPoints.map((point) => point.id);
    editor.selection.select([ids[0], ids[2], ids[4]]);
    await editor.deleteSelection();
    expect(layer().contours[0].closed).toBe(true);
    expect(
      layer()
        .allPoints.filter(Point.isOnCurve)
        .map((point) => point.id),
    ).toEqual([ids[1], ids[3]]);
    expect(
      layer()
        .contours[0].segments()
        .map((segment) => segment.type),
    ).toEqual(["cubic", "cubic"]);
  });

  it.each(["fit", "gap"] as const)(
    "retains one surviving point as an open contour in %s mode",
    async (mode) => {
      const ids = layer().allPoints.map((point) => point.id);
      editor.selection.select(ids.slice(1));
      await editor.deleteSelection(mode);
      expect(layer().allPoints.map((point) => point.id)).toEqual([ids[0]]);
      expect(layer().contours[0].closed).toBe(false);
      expect(layer().contours[0].segments()).toEqual([]);
    },
  );

  it("fits across leading off-curve controls without treating them as an open endpoint", async () => {
    const closing = layer().contours[0].segments().at(-1)!;
    layer().upgradeLineToCubic(closing.id);
    await editor.settle();
    expect(Point.isOffCurve(layer().allPoints[0])).toBe(true);
    editor.selection.select([closing.endId]);
    await editor.deleteSelection();
    expect(layer().contours[0].closed).toBe(true);
    expect(layer().allPoints.filter(Point.isOnCurve)).toHaveLength(4);
    expect(
      layer()
        .contours[0].segments()
        .map((segment) => segment.type),
    ).toEqual(["line", "line", "line", "cubic"]);
    expect(
      layer()
        .contours[0].segments()
        .every((segment) => Point.isOnCurve(segment.start) && Point.isOnCurve(segment.end)),
    ).toBe(true);
  });

  it("converts the wrapped cubic to a line when a leading control is selected", async () => {
    const closing = layer().contours[0].segments().at(-1)!;
    layer().upgradeLineToCubic(closing.id);
    await editor.settle();
    editor.selection.select([layer().allPoints[0].id]);
    await editor.deleteSelection();
    expect(layer().allPoints.every(Point.isOnCurve)).toBe(true);
    expect(
      layer()
        .contours[0].segments()
        .map((segment) => segment.type),
    ).toEqual(["line", "line", "line", "line", "line"]);
    expect(layer().contours[0].closed).toBe(true);
  });

  it("removes unselected handles when every on-curve point is selected", async () => {
    layer().upgradeLineToCubic(layer().contours[0].segments()[0].id);
    await editor.settle();
    editor.selection.select(
      layer()
        .allPoints.filter(Point.isOnCurve)
        .map((point) => point.id),
    );
    await editor.deleteSelection();
    expect(layer().contours).toEqual([]);
  });

  it("removes a selected whole contour and restores its exact order on undo", async () => {
    const before = layer().state;
    editor.selection.select([layer().contours[0].id]);
    await editor.deleteSelection();
    expect(layer().contours).toEqual([]);
    await editor.undo();
    expect(layer().state).toEqual(before);
  });
});
