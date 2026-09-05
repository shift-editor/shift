import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Curve, Vec2 } from "@shift/geo";
import { Point } from "@shift/glyph-state";
import { mintPointId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

let editor: TestEditor;
const layer = () => editor.requireGlyphLayer();

beforeEach(async () => {
  editor = new TestEditor();
  await editor.startSession();
  editor.selectTool("pen");
});
afterEach(() => editor.destroy());

describe("deleting on-curve points fits their original span", () => {
  beforeEach(async () => {
    await editor.clickGlyphLocal(0, 0);
    await editor.dragScene({
      down: { x: 200, y: 0 },
      start: { x: 200, y: -40 },
      end: { x: 200, y: -100 },
    });
  });

  it("recovers a split cubic and retains its endpoints", async () => {
    const original = layer().contours[0].segments()[0];
    const selected = layer().splitSegment(original.id, 0.4)!;
    await editor.settle();
    editor.selection.select([selected]);
    expect(await editor.deleteSelection()).toBe(true);
    const result = layer().contours[0].segments();
    expect(result).toHaveLength(1);
    expect(
      result[0].pointIds.filter((id) => id === original.startId || id === original.endId),
    ).toEqual([original.startId, original.endId]);
    expect(
      Math.max(
        ...Curve.sample(original.toCurve(), 40).map((point, index) =>
          Vec2.dist(point, Curve.pointAt(result[0].toCurve(), index / 40)),
        ),
      ),
    ).toBeLessThan(0.1);
    expect(layer().point(selected)).toBeNull();
    expect(editor.selection.ids).toEqual([]);
  });

  it("restores exact points, smooth flags, identities and order with one undo", async () => {
    const selected = layer().splitSegment(layer().contours[0].segments()[0].id, 0.4)!;
    await editor.settle();
    const before = layer().state;
    editor.selection.select([selected]);
    await editor.deleteSelection();
    const deleted = layer().state;
    await editor.undo();
    expect(layer().state).toEqual(before);
    await editor.redo();
    expect(layer().state).toEqual(deleted);
  });

  it("uses the original span when its point and handles are selected together", async () => {
    const selected = layer().splitSegment(layer().contours[0].segments()[0].id, 0.4)!;
    await editor.settle();
    const handle = layer().contours[0].segments()[0].asCubic()!.controlStart.id;
    editor.selection.select([selected]);
    await editor.deleteSelection();
    const fitted = Curve.sample(layer().contours[0].segments()[0].toCurve(), 16);
    await editor.undo();
    editor.selection.select([handle, selected]);
    await editor.deleteSelection();
    expect(Curve.sample(layer().contours[0].segments()[0].toCurve(), 16)).toEqual(fitted);
    expect(layer().point(handle)).toBeNull();
  });

  it("fits adjacent selected points once regardless of selection order", async () => {
    const first = layer().splitSegment(layer().contours[0].segments()[0].id, 0.3)!;
    const second = layer().splitSegment(layer().contours[0].segments()[1].id, 0.6)!;
    await editor.settle();
    editor.selection.select([first, second]);
    await editor.deleteSelection();
    const fitted = Curve.sample(layer().contours[0].segments()[0].toCurve(), 16);
    await editor.undo();
    editor.selection.select([second, first]);
    await editor.deleteSelection();
    expect(layer().contours[0].segments()).toHaveLength(1);
    expect(Curve.sample(layer().contours[0].segments()[0].toCurve(), 16)).toEqual(fitted);
  });

  it("treats a selected segment like all of its points selected", async () => {
    layer().splitSegment(layer().contours[0].segments()[0].id, 0.25);
    layer().splitSegment(layer().contours[0].segments()[1].id, 0.65);
    await editor.settle();
    const middle = layer().contours[0].segments()[1];
    editor.selection.select([middle.id]);
    await editor.deleteSelection();
    const fitted = Curve.sample(layer().contours[0].segments()[0].toCurve(), 16);
    await editor.undo();
    editor.selection.select(middle.pointIds);
    await editor.deleteSelection();
    expect(Curve.sample(layer().contours[0].segments()[0].toCurve(), 16)).toEqual(fitted);
  });

  it("leaves two isolated endpoints when a gap consumes the only two segments", async () => {
    const selected = layer().splitSegment(layer().contours[0].segments()[0].id, 0.4)!;
    await editor.settle();
    const endpoints = layer()
      .contours[0].points.filter(Point.isOnCurve)
      .filter((point) => point.id !== selected)
      .map((point) => point.id);
    editor.selection.select([selected]);
    await editor.deleteSelection("gap");
    expect(layer().contours.map((contour) => contour.points.map((point) => point.id))).toEqual(
      endpoints.map((id) => [id]),
    );
    expect(layer().contours.every((contour) => !contour.closed)).toBe(true);
    expect(layer().allPoints.every(Point.isOnCurve)).toBe(true);
  });

  it("publishes the same complete topology locally and after the workspace echo", async () => {
    const selected = layer().splitSegment(layer().contours[0].segments()[0].id, 0.4)!;
    await editor.settle();
    layer().deletePoints([selected]);
    const local = layer().state;
    expect(layer().contours[0].segments()).toHaveLength(1);
    expect(layer().point(selected)).toBeNull();
    await editor.settle();
    expect(layer().state).toEqual(local);
  });

  it("does not edit an interpolated location", async () => {
    const before = layer().state;
    editor.selectAll();
    editor.setExternalLocation(editor.font.defaultLocation());
    expect(editor.activeSourceId).toBeNull();
    expect(await editor.deleteSelection()).toBe(false);
    editor.selectSource(editor.font.defaultSource.id);
    expect(layer().state).toEqual(before);
  });
});

describe("deleting cubic handles converts the segment to a line", () => {
  beforeEach(async () => {
    await editor.clickGlyphLocal(0, 0);
    await editor.dragScene({
      down: { x: 200, y: 0 },
      start: { x: 200, y: -40 },
      end: { x: 200, y: -100 },
    });
  });

  it.each(["fit", "gap"] as const)("removes both handles in %s mode", async (mode) => {
    const original = layer().contours[0].segments()[0];
    const controls = original.flatPoints.filter(Point.isOffCurve);
    editor.selection.select([controls[0].id]);
    await editor.deleteSelection(mode);
    expect(
      layer()
        .contours[0].segments()
        .map((segment) => segment.type),
    ).toEqual(["line"]);
    expect(layer().allPoints.map((point) => point.id)).toEqual([original.startId, original.endId]);
    expect(controls.every((point) => layer().point(point.id) === null)).toBe(true);
  });

  it("removes a segment's handles only once when both are selected", async () => {
    const original = layer().state;
    editor.selection.select(
      layer()
        .allPoints.filter(Point.isOffCurve)
        .map((point) => point.id),
    );
    await editor.deleteSelection();
    expect(layer().pointCount).toBe(2);
    await editor.undo();
    expect(layer().state).toEqual(original);
  });

  it("does not modify adjoining unselected geometry", async () => {
    const selected = layer().contours[0].segments()[0].asCubic()!.controlStart.id;
    await editor.dragScene({
      down: { x: 400, y: 0 },
      start: { x: 400, y: 40 },
      end: { x: 400, y: 100 },
    });
    const next = layer().contours[0].segments()[1];
    editor.selection.select([selected]);
    await editor.deleteSelection();
    expect(layer().contours[0].segments()[1].pointIds).toEqual(next.pointIds);
    expect(layer().contours[0].segments()[1].toCurve()).toEqual(next.toCurve());
  });
});

describe("deletion refuses absent or unsupported selections without edits", () => {
  it("does not create an undo entry for an empty selection", async () => {
    await editor.drawOpenContour([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    editor.selection.clear();
    expect(await editor.deleteSelection()).toBe(false);
    await editor.undo();
    expect(layer().pointCount).toBe(1);
  });

  it("rejects a selection containing a stale identity atomically", async () => {
    const ids = await editor.drawOpenContour([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    const before = layer().state;
    expect(layer().deletePoints([ids[0], mintPointId()])).toBe(false);
    await editor.settle();
    expect(layer().state).toEqual(before);
  });

  it("retains anchors when they are mixed into a point selection", async () => {
    const [id] = await editor.drawOpenContour([{ x: 0, y: 0 }]);
    const anchor = layer().addAnchor("top", { x: 0, y: 100 });
    await editor.settle();
    const before = layer().state;
    editor.selection.select([id, anchor]);
    expect(await editor.deleteSelection()).toBe(false);
    expect(layer().state).toEqual(before);
  });
});
