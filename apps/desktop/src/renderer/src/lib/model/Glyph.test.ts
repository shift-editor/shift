import { beforeEach, describe, expect, it } from "vitest";
import type { GlyphName, GlyphRecord, PointId } from "@shift/types";
import type { Point } from "@shift/glyph-state";
import { effect, signal, track } from "@/lib/signals/signal";
import { emptyExternalAxisLocation } from "@/lib/variation/location";
import { TestEditor } from "@/testing/TestEditor";
import type { GlyphLayer } from "./Glyph";
import { RenderGlyph } from "./RenderGlyph";

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

  layer.addPoint(contourId, {
    x: 0,
    y: 0,
    pointType: "onCurve",
    smooth: false,
  });
  layer.addPoint(contourId, {
    x: 100,
    y: 0,
    pointType: "onCurve",
    smooth: false,
  });
  layer.addPoint(contourId, {
    x: 50,
    y: 100,
    pointType: "onCurve",
    smooth: false,
  });
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
  let record: GlyphRecord;
  let layer: GlyphLayer;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    layer = editor.glyphLayer!;
    const glyphRecord = editor.glyphRecord;
    if (!glyphRecord) throw new Error("Expected scene glyph record");
    record = glyphRecord;
  });

  it("loads identity and state from the workspace", () => {
    expect(record.name).toBe("A");
    expect(record.unicodes[0]).toBe(65);
    expect(layer.contours.length).toBe(0);
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
    const renderModel = editor.sceneGlyphRenderModel;
    if (!renderModel) throw new Error("Expected Glyph render model");

    layer.applyPositionPatch([{ kind: "point", id: first!.id, x: 25, y: 75 }]);
    expect(renderModel.point(first!.id)).toMatchObject({ x: 25, y: 75 });

    await editor.settle();
    expect(renderModel.point(first!.id)).toMatchObject({ x: 25, y: 75 });
  });

  it("publishes structural edits before their workspace echo", async () => {
    const contourId = layer.addContour();
    const pointId = layer.addOnCurvePoint(contourId, { x: 10, y: 20 });

    expect(layer.contour(contourId)?.points[0]).toMatchObject({ id: pointId, x: 10, y: 20 });

    await editor.settle();
    expect(layer.contour(contourId)?.points[0]).toMatchObject({ id: pointId, x: 10, y: 20 });
  });

  it("publishes deletions before their workspace echo", async () => {
    const [first] = await addTriangle(editor, layer);

    layer.removePoints([first!.id]);
    expect(layer.point(first!.id)).toBeNull();

    await editor.settle();
    expect(layer.point(first!.id)).toBeNull();
  });

  it("publishes advance changes before their workspace echo", async () => {
    layer.setXAdvance(640);
    expect(layer.xAdvance).toBe(640);

    await editor.settle();
    expect(layer.xAdvance).toBe(640);
  });

  it("targets a newly pending point before its add echo", async () => {
    const contourId = layer.addContour();
    const pointId = layer.addOnCurvePoint(contourId, { x: 10, y: 20 });

    layer.toggleSmooth(pointId);
    expect(layer.point(pointId)?.smooth).toBe(true);

    await editor.settle();
    expect(layer.point(pointId)?.smooth).toBe(true);
  });

  it("never republishes an older position while rapid edits confirm", async () => {
    const [first] = await addTriangle(editor, layer);
    const observedX: number[] = [];
    const subscription = effect(() => {
      track(layer.coordinateBuffersChangedCell);
      observedX.push(layer.point(first!.id)?.x ?? NaN);
    });

    layer.movePointTo(first!.id, { x: 10, y: 0 });
    layer.movePointTo(first!.id, { x: 20, y: 0 });
    await editor.settle();

    expect(observedX).toEqual([0, 10, 20]);
    subscription.dispose();
  });

  it("publishes a transaction as one complete structural state", async () => {
    const pointCounts: number[] = [];
    const subscription = effect(() => {
      pointCounts.push(layer.geometryCell.value.allPoints.length);
    });

    editor.transaction("Create line", () => {
      const contourId = layer.addContour();
      layer.addOnCurvePoint(contourId, { x: 0, y: 0 });
      layer.addOnCurvePoint(contourId, { x: 100, y: 0 });
    });
    await editor.settle();

    expect(pointCounts).toEqual([0, 2]);
    subscription.dispose();
  });

  it("resyncs local geometry when the workspace rejects an edit", async () => {
    const [first] = await addTriangle(editor, layer);
    await editor.addGlyph("B", 66);
    const otherRecord = editor.font.recordForName("B" as GlyphName);
    const otherGlyph = otherRecord ? editor.glyphForId(otherRecord.id) : null;
    const otherLayer = otherGlyph?.layerForSource(editor.font.defaultSource.id);
    if (!otherLayer) throw new Error("Expected second glyph layer");
    const duplicateContourId = otherLayer.addContour();
    await editor.settle();

    layer.previewPositionPatch([{ kind: "point", id: first!.id, x: 999, y: 999 }]);
    editor.font.editCoordinator.push({
      kind: "addContour",
      addContour: { layerId: layer.layerId, contourId: duplicateContourId, closed: false },
    });
    await editor.settle();

    const refreshedGlyph = await editor.font.loadGlyph(record.id);
    expect(refreshedGlyph.layerForSource(layer.source.id)?.point(first!.id)).toMatchObject({
      x: 0,
      y: 0,
    });
  });

  it("discards every transaction intent when its body throws", async () => {
    expect(() =>
      editor.transaction("Rejected contour", () => {
        layer.addContour();
        throw new Error("reject edit");
      }),
    ).toThrow("reject edit");

    await editor.settle();
    expect(layer.contours).toHaveLength(0);
  });

  it("feeds consumers that track source coordinate changes before reading geometry", async () => {
    const [first] = await addTriangle(editor, layer);
    let pointX = first!.x;

    const subscription = effect(() => {
      track(layer.coordinateBuffersChangedCell);
      pointX = layer.point(first!.id)?.x ?? pointX;
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
    layer = editor.glyphLayer!;
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

    layer.applyPositionPatch([{ kind: "anchor", id: anchorId, x: 300, y: 650 }]);
    await editor.settle();

    expect(layer.anchor(anchorId)).toMatchObject({ x: 300, y: 650 });
  });

  it("mixed point and anchor commits undo as one layer operation", async () => {
    const contourId = layer.addContour();
    layer.addOnCurvePoint(contourId, { x: 0, y: 0 });
    const anchorId = layer.addAnchor("top", { x: 250, y: 700 });
    await editor.settle();
    const pointId = layer.allPoints[0]!.id;

    layer.applyPositionPatch([
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
  let record: GlyphRecord;
  let layer: GlyphLayer;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    layer = editor.glyphLayer!;
    const glyphRecord = editor.glyphRecord;
    if (!glyphRecord) throw new Error("Expected scene glyph record");
    record = glyphRecord;
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
    expect(layer.bounds).toEqual(editor.sceneGlyphRenderModel?.bounds);
  });

  it("applies committed point patches to the source and owning glyph geometry", async () => {
    const [, second] = await addTriangle(editor, layer);

    layer.applyPositionPatch([{ kind: "point", id: second!.id, x: 25, y: 75 }]);
    await editor.settle();

    expect(sourcePosition(layer, second!.id)).toEqual({ x: 25, y: 75 });
    expect(pointPosition(layer, second!.id)).toEqual({ x: 25, y: 75 });
    expect(editor.sceneGlyphRenderModel?.point(second!.id)).toMatchObject({ x: 25, y: 75 });
  });

  it("commits a preview without double-applying local positions", async () => {
    const [, second] = await addTriangle(editor, layer);

    layer.previewPositionPatch([{ kind: "point", id: second!.id, x: 25, y: 75 }]);
    layer.applyPositionPatch([{ kind: "point", id: second!.id, x: 25, y: 75 }]);
    await editor.settle();

    expect(sourcePosition(layer, second!.id)).toEqual({ x: 25, y: 75 });
    expect(pointPosition(layer, second!.id)).toEqual({ x: 25, y: 75 });

    const committed = layer.positionsFor([{ kind: "point", id: second!.id }])[0];
    if (!committed) throw new Error("Expected committed position");

    layer.previewPositionPatch([
      {
        kind: "point",
        id: second!.id,
        x: committed.x + 10,
        y: committed.y + 5,
      },
    ]);

    expect(pointPosition(layer, second!.id)).toEqual({ x: 35, y: 80 });
  });

  it("keeps the source-independent RenderGlyph view live", async () => {
    await addTriangle(editor, layer);
    const glyph = editor.glyphForId(record.id);
    if (!glyph) throw new Error("Expected Glyph");
    const rendered = new RenderGlyph(glyph.renderModelAt(signal(emptyExternalAxisLocation())));

    layer.setXAdvance(530);
    await editor.settle();

    expect(rendered.xAdvance).toBe(530);
  });

  it("keeps source-backed render contours fresh after position edits", async () => {
    const [, second] = await addTriangle(editor, layer);
    const glyph = editor.glyphForId(record.id);
    if (!glyph) throw new Error("Expected Glyph");
    const renderModel = glyph.renderModelAt(signal(emptyExternalAxisLocation()));

    layer.applyPositionPatch([{ kind: "point", id: second!.id, x: 25, y: 75 }]);
    await editor.settle();

    expect(renderModel.point(second!.id)).toMatchObject({ x: 25, y: 75 });
    expect(renderModel.allPoints.find((point) => point.id === second!.id)).toMatchObject({
      x: 25,
      y: 75,
    });
    expect(
      renderModel.contours.at(-1)?.contour.points.find((point) => point.id === second!.id),
    ).toMatchObject({ x: 25, y: 75 });
  });

  it("invalidates source-backed render contours read before a position edit", async () => {
    const [, second] = await addTriangle(editor, layer);
    const glyph = editor.glyphForId(record.id);
    if (!glyph) throw new Error("Expected Glyph");
    const renderModel = glyph.renderModelAt(signal(emptyExternalAxisLocation()));

    expect(
      renderModel.contours.at(-1)?.contour.points.find((point) => point.id === second!.id),
    ).toMatchObject({ x: 100, y: 0 });

    layer.applyPositionPatch([{ kind: "point", id: second!.id, x: 25, y: 75 }]);
    await editor.settle();

    expect(renderModel.point(second!.id)).toMatchObject({ x: 25, y: 75 });
    expect(
      renderModel.contours.at(-1)?.contour.points.find((point) => point.id === second!.id),
    ).toMatchObject({ x: 25, y: 75 });
  });
});
