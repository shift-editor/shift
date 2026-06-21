import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import type { Point } from "@shift/glyph-state";
import { effect } from "@/lib/signals/signal";
import { axisLocationFromLocation } from "@/lib/variation/location";
import { TestEditor } from "@/testing/TestEditor";
import type { Glyph, GlyphLayer } from "./Glyph";

/**
 * Restored from the WS6 behavioral inventory (git show ef037c6e^), rebuilt on
 * the workspace stack: geometry is authored through intents instead of a
 * MutatorSans fixture, so each test draws what it asserts on.
 *
 * Not restored yet (blocked on workspace vocabulary):
 * - "Glyph variation interpolation" — needs multi-source/axes vocabulary.
 */
async function addTriangle(editor: TestEditor, layer: GlyphLayer): Promise<readonly Point[]> {
  const contourId = layer.addContour();

  layer.addPoint(contourId, { x: 0, y: 0, pointType: "onCurve", smooth: false });
  layer.addPoint(contourId, { x: 100, y: 0, pointType: "onCurve", smooth: false });
  layer.addPoint(contourId, { x: 50, y: 100, pointType: "onCurve", smooth: false });
  layer.closeContour(contourId);
  await editor.settle();

  const contour = layer.contour(contourId);
  if (!contour) throw new Error("Expected created contour");
  return contour.points;
}

function pointPosition(layer: GlyphLayer, pointId: PointId): { x: number; y: number } {
  const point = layer.point(pointId);
  if (!point) throw new Error("Expected point");

  return { x: point.x, y: point.y };
}

function sourcePosition(layer: GlyphLayer, pointId: PointId): { x: number; y: number } {
  const position = layer.positionsFor([{ kind: "point", id: pointId }])[0];
  if (!position) throw new Error("Expected source position");

  return { x: position.x, y: position.y };
}

describe("Glyph", () => {
  let editor: TestEditor;
  let glyph: Glyph;
  let layer: GlyphLayer;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    layer = editor.editingGlyphLayer!;
    const record = editor.font.recordForName(editor.rootGlyphHandle!.name)!;
    glyph = editor.font.glyphForId(record.id)!;
  });

  it("hydrates identity and state from the workspace", () => {
    expect(glyph.name).toBe("A");
    expect(glyph.unicode).toBe(65);
    expect(glyph.contours.length).toBe(0);
  });

  it("applies structural edits echoed by the workspace", async () => {
    const points = await addTriangle(editor, layer);

    expect(layer.contours.at(-1)?.closed).toBe(true);
    expect(points.map((point) => [point.x, point.y])).toEqual([
      [0, 0],
      [100, 0],
      [50, 100],
    ]);
  });

  it("updates positions synchronously and keeps them after the echo folds", async () => {
    const [first] = await addTriangle(editor, layer);

    layer.applyPositionPatch([{ kind: "point", id: first!.id, x: 25, y: 75 }]);
    expect(glyph.point(first!.id)).toMatchObject({ x: 25, y: 75 });

    await editor.settle();
    expect(glyph.point(first!.id)).toMatchObject({ x: 25, y: 75 });
  });

  it("feeds consumers that track source coordinate changes before reading geometry", async () => {
    const [first] = await addTriangle(editor, layer);
    let pointX = first!.x;

    const subscription = effect(() => {
      layer.coordinateBuffersChangedCell.value;
      pointX = glyph.point(first!.id)?.x ?? pointX;
    });

    layer.applyPositionPatch([{ kind: "point", id: first!.id, x: 33, y: 44 }]);

    expect(pointX).toBe(33);
    subscription.dispose();
  });
});

describe("anchors edit through the workspace", () => {
  let editor: TestEditor;
  let layer: GlyphLayer;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    layer = editor.editingGlyphLayer!;
  });

  it("addAnchor echoes a named anchor into confirmed geometry", async () => {
    const anchorId = layer.addAnchor("top", { x: 250, y: 700 });
    await editor.settle();

    const anchor = layer.anchor(anchorId);
    expect(anchor?.name).toBe("top");
    expect(anchor).toMatchObject({ x: 250, y: 700 });
    expect(layer.anchors.length).toBe(1);
  });

  it("commits anchor moves through the moveAnchors intent", async () => {
    const anchorId = layer.addAnchor("top", { x: 250, y: 700 });
    await editor.settle();

    layer.commitPositionPatch([{ kind: "anchor", id: anchorId, x: 300, y: 650 }]);
    await editor.settle();

    expect(layer.anchor(anchorId)).toMatchObject({ x: 300, y: 650 });
  });

  it("mixed point and anchor commits coalesce into one undo step", async () => {
    const contourId = layer.addContour();
    layer.addOnCurvePoint(contourId, { x: 0, y: 0 });
    const anchorId = layer.addAnchor("top", { x: 250, y: 700 });
    await editor.settle();
    const pointId = layer.allPoints[0]!.id;

    layer.commitPositionPatch([
      { kind: "point", id: pointId, x: 10, y: 20 },
      { kind: "anchor", id: anchorId, x: 300, y: 650 },
    ]);
    await editor.settle();
    expect(layer.point(pointId)).toMatchObject({ x: 10, y: 20 });
    expect(layer.anchor(anchorId)).toMatchObject({ x: 300, y: 650 });

    await editor.undoAndSettle();
    expect(layer.point(pointId)).toMatchObject({ x: 0, y: 0 });
    expect(layer.anchor(anchorId)).toMatchObject({ x: 250, y: 700 });
  });

  it("undo removes an added anchor and redo restores it", async () => {
    const anchorId = layer.addAnchor(null, { x: 100, y: 100 });
    await editor.settle();
    expect(layer.anchors.length).toBe(1);

    await editor.undoAndSettle();
    expect(layer.anchors.length).toBe(0);

    await editor.redoAndSettle();
    expect(layer.anchor(anchorId)).toMatchObject({ x: 100, y: 100 });
  });

  it("removeAnchors deletes through the workspace", async () => {
    const anchorId = layer.addAnchor("top", { x: 250, y: 700 });
    await editor.settle();

    layer.removeAnchors([anchorId]);
    await editor.settle();

    expect(layer.anchors.length).toBe(0);
    expect(layer.anchor(anchorId)).toBeNull();
  });
});

describe("glyph layers keep public geometry coherent across position edits", () => {
  let editor: TestEditor;
  let glyph: Glyph;
  let layer: GlyphLayer;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    layer = editor.editingGlyphLayer!;
    const record = editor.font.recordForName(editor.rootGlyphHandle!.name)!;
    glyph = editor.font.glyphForId(record.id)!;
  });

  it("previews point patches through every public layer geometry view", async () => {
    const [, second] = await addTriangle(editor, layer);

    layer.previewPositionPatch([{ kind: "point", id: second!.id, x: 25, y: 75 }]);

    expect(sourcePosition(layer, second!.id)).toEqual({ x: 25, y: 75 });
    expect(pointPosition(layer, second!.id)).toEqual({ x: 25, y: 75 });
    expect(layer.contours.at(-1)?.points[1]).toMatchObject({ x: 25, y: 75 });
    expect(layer.allPoints.find((point) => point.id === second!.id)).toMatchObject({
      x: 25,
      y: 75,
    });
    expect(layer.bounds).toEqual(glyph.bounds);
  });

  it("applies committed point patches to the source and owning glyph geometry", async () => {
    const [, second] = await addTriangle(editor, layer);

    layer.applyPositionPatch([{ kind: "point", id: second!.id, x: 25, y: 75 }]);
    await editor.settle();

    expect(sourcePosition(layer, second!.id)).toEqual({ x: 25, y: 75 });
    expect(pointPosition(layer, second!.id)).toEqual({ x: 25, y: 75 });
    expect(glyph.point(second!.id)).toMatchObject({ x: 25, y: 75 });
  });

  it("commits a preview without stale geometry or double-applying local positions", async () => {
    const [, second] = await addTriangle(editor, layer);

    layer.previewPositionPatch([{ kind: "point", id: second!.id, x: 25, y: 75 }]);
    layer.commitPositionPatch([{ kind: "point", id: second!.id, x: 25, y: 75 }]);
    await editor.settle();

    expect(sourcePosition(layer, second!.id)).toEqual({ x: 25, y: 75 });
    expect(pointPosition(layer, second!.id)).toEqual({ x: 25, y: 75 });

    const committed = layer.positionsFor([{ kind: "point", id: second!.id }])[0];
    if (!committed) throw new Error("Expected committed position");

    layer.previewPositionPatch([
      { kind: "point", id: second!.id, x: committed.x + 10, y: committed.y + 5 },
    ]);

    expect(pointPosition(layer, second!.id)).toEqual({ x: 35, y: 80 });
  });

  it("keeps source-backed instance geometry contours fresh after position edits", async () => {
    const [, second] = await addTriangle(editor, layer);
    const instance = glyph.instanceAt(axisLocationFromLocation(layer.source.location));

    layer.applyPositionPatch([{ kind: "point", id: second!.id, x: 25, y: 75 }]);
    await editor.settle();

    expect(instance.geometry.point(second!.id)).toMatchObject({ x: 25, y: 75 });
    expect(instance.geometry.allPoints.find((point) => point.id === second!.id)).toMatchObject({
      x: 25,
      y: 75,
    });
    expect(
      instance.geometry.contours.at(-1)?.points.find((point) => point.id === second!.id),
    ).toMatchObject({ x: 25, y: 75 });
  });

  it("invalidates source-backed instance contours that were read before a position edit", async () => {
    const [, second] = await addTriangle(editor, layer);
    const instance = glyph.instanceAt(axisLocationFromLocation(layer.source.location));

    expect(
      instance.geometry.contours.at(-1)?.points.find((point) => point.id === second!.id),
    ).toMatchObject({ x: 100, y: 0 });

    layer.applyPositionPatch([{ kind: "point", id: second!.id, x: 25, y: 75 }]);
    await editor.settle();

    expect(instance.geometry.point(second!.id)).toMatchObject({ x: 25, y: 75 });
    expect(
      instance.geometry.contours.at(-1)?.points.find((point) => point.id === second!.id),
    ).toMatchObject({ x: 25, y: 75 });
  });
});
