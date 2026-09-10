import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Point } from "@shift/glyph-state";
import { mintPointId, type ContourId, type PointId } from "@shift/types";
import { effect } from "@/lib/signals/signal";
import { TestEditor } from "@/testing/TestEditor";
import type { GlyphLayer } from "./Glyph";

describe("point insertion preserves layer ownership", () => {
  let editor: TestEditor;
  let layer: GlyphLayer;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    layer = editor.requireGlyphLayer();
  });

  afterEach(async () => {
    await editor.settle();
    editor.destroy();
  });

  it("appends ordered geometry with fresh identities before and after confirmation", async () => {
    const contourId = layer.addContour();
    const points = [
      Point.onCurve({ x: 10, y: 20 }),
      Point.offCurve({ x: 30, y: 80 }),
      Point.offCurve({ x: 60, y: 80 }),
      Point.smooth({ x: 90, y: 20 }),
    ];
    const pointIds = layer.addPoints(contourId, points);
    expect(new Set(pointIds).size).toBe(4);
    expect(layer.contour(contourId)?.points).toMatchObject(
      points.map((point, index) => ({ ...point, id: pointIds[index] })),
    );
    expect(pointIds.map((id) => layer.contourIdOfPoint(id))).toEqual(Array(4).fill(contourId));

    await editor.settle();
    expect(layer.contour(contourId)?.points).toMatchObject(
      points.map((point, index) => ({ ...point, id: pointIds[index] })),
    );
    expect(pointIds.map((id) => layer.contourIdOfPoint(id))).toEqual(Array(4).fill(contourId));
  });

  it("does not create an undo entry for an empty insertion", async () => {
    const contourId = layer.addContour();
    await editor.settle();
    expect(layer.addPoints(contourId, [])).toEqual([]);
    await editor.settle();

    await editor.undo();
    expect(layer.contour(contourId)).toBeNull();
  });

  it("removes ownership immediately and restores it through undo and redo", async () => {
    const contourId = layer.addContour();
    const [pointId] = layer.addPoints(contourId, [Point.onCurve({ x: 10, y: 20 })]);
    await editor.settle();

    layer.removePoints([pointId!]);
    expect(layer.contourIdOfPoint(pointId!)).toBeNull();
    expect(layer.contour(contourId)).toBeNull();
    await editor.settle();
    await editor.undo();
    expect(layer.contourIdOfPoint(pointId!)).toBe(contourId);
    expect(layer.positionsFor([{ kind: "point", id: pointId! }])).toMatchObject([{ x: 10, y: 20 }]);
    await editor.redo();
    expect(layer.contourIdOfPoint(pointId!)).toBeNull();
  });

  it("publishes active geometry and point ownership together", () => {
    const edit = layer.beginEdit();
    const contourId = edit.addContour(false);
    const observed: (ContourId | null)[][] = [];
    const subscription = effect(() => {
      observed.push(
        layer.structureCell.value.contours.flatMap((contour) =>
          contour.points.map((point) => layer.contourIdOfPoint(point.id)),
        ),
      );
    });
    edit.addPoints(contourId, [Point.onCurve({ x: 0, y: 0 }), Point.onCurve({ x: 10, y: 20 })]);
    edit.cancel();
    subscription.dispose();

    expect(observed).toEqual([[], [contourId, contourId], []]);
  });

  it("drops inserted ownership when a transaction rolls back", () => {
    const contourId = layer.addContour();
    let pointIds: PointId[] = [];
    expect(() =>
      editor.transaction("Rejected points", () => {
        pointIds = layer.addPoints(contourId, [Point.onCurve({ x: 10, y: 20 })]);
        throw new Error("reject insertion");
      }),
    ).toThrow("reject insertion");

    expect(pointIds.map((id) => layer.contourIdOfPoint(id))).toEqual([null]);
    expect(layer.contour(contourId)?.points).toEqual([]);
  });

  it("rejects a duplicate identity without changing its existing contour", () => {
    const contourId = layer.addContour();
    const [pointId] = layer.addPoints(contourId, [Point.onCurve({ x: 10, y: 20 })]);
    const otherContourId = layer.addContour();
    const point = layer.point(pointId!)!;

    expect(layer.buffers.addPoints([point], otherContourId)).toBe(false);
    expect(layer.contourIdOfPoint(pointId!)).toBe(contourId);
    expect(layer.contour(otherContourId)?.points).toEqual([]);
  });

  it("does not reserve point ownership after rejecting an insertion position", () => {
    const contourId = layer.addContour();
    const otherContourId = layer.addContour();
    const [before] = layer.addPoints(otherContourId, [Point.onCurve({ x: 0, y: 0 })]);
    const point = { id: mintPointId(), ...Point.onCurve({ x: 10, y: 20 }) };

    expect(layer.buffers.addPoints([point], contourId, before)).toBe(false);
    expect(layer.contourIdOfPoint(point.id)).toBeNull();
    layer.addPointSeeds(contourId, [point]);
    expect(layer.contourIdOfPoint(point.id)).toBe(contourId);
    expect(layer.point(point.id)).toMatchObject({ x: 10, y: 20 });
  });
});
