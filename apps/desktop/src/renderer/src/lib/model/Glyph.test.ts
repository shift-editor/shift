import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mintPointId,
  type ContourId,
  type GlyphName,
  type GlyphRecord,
  type PointId,
  type SourceId,
  type Unicode,
} from "@shift/types";
import { Point } from "@shift/glyph-state";
import { Curve } from "@shift/geo";
import { effect, signal, track } from "@shift/editor/signals";
import { emptyExternalAxisLocation } from "@shift/editor/variation";
import { createWorkspaceStack, type WorkspaceStack } from "@/testing/workspaceStack";
import type { Glyph, GlyphLayer, GlyphRenderModel } from "@shift/editor/model";
import { RenderGlyph } from "@shift/editor/model";

/**
 * Restored from the WS6 behavioral inventory (git show ef037c6e^), rebuilt on
 * the workspace stack: geometry is authored through intents instead of a
 * MutatorSans fixture, so each test draws what it asserts on.
 *
 * Not restored yet (blocked on workspace vocabulary):
 * - "Glyph variation interpolation" — needs multi-source/axes vocabulary.
 */
/** A new workspace font's glyph `A` (U+0041), loaded, as the canvas would show it at the default source. */
interface WorkspaceGlyph {
  readonly stack: WorkspaceStack;
  readonly record: GlyphRecord;
  readonly glyph: Glyph;
  readonly layer: GlyphLayer;
  /** The glyph's render model at the default source, as the canvas draws it. */
  readonly renderModel: GlyphRenderModel;
}

/** Creates a workspace font over the real workspace stack and loads its glyph `A`. */
async function startWorkspaceGlyph(): Promise<WorkspaceGlyph> {
  const stack = createWorkspaceStack();
  await stack.createWorkspace();
  const created = stack.font.createGlyphForUnicode(65 as Unicode);
  await stack.editCoordinator.settled();

  const sourceId = stack.font.defaultSource.id;
  const glyph = await stack.font.loadGlyph(created.id);
  const layer = glyph.layerForSource(sourceId);
  const record = stack.font.recordForId(created.id);
  if (!layer || !record) throw new Error("Expected the glyph's default layer and record");

  const renderModel = glyph.renderModelAt(
    signal(emptyExternalAxisLocation()),
    signal<SourceId | null>(sourceId),
  );
  return { stack, record, glyph, layer, renderModel };
}

async function addTriangle(stack: WorkspaceStack, layer: GlyphLayer): Promise<readonly Point[]> {
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
  await stack.editCoordinator.settled();

  const contour = layer.contour(contourId);
  if (!contour) throw new Error("Expected created contour");
  return contour.points;
}

function sourcePosition(layer: GlyphLayer, pointId: PointId): { x: number; y: number } {
  const position = layer.positionsFor([{ kind: "point", id: pointId }])[0];
  if (!position) throw new Error("Expected source position");

  return { x: position.x, y: position.y };
}

describe("Glyph", () => {
  let stack: WorkspaceStack;
  let record: GlyphRecord;
  let layer: GlyphLayer;
  let renderModel: GlyphRenderModel;

  beforeEach(async () => {
    ({ stack, record, layer, renderModel } = await startWorkspaceGlyph());
  });

  afterEach(async () => {
    await stack.editCoordinator.settled();
    stack.dispose();
  });

  it("loads identity and state from the workspace", () => {
    expect(record.name).toBe("A");
    expect(record.unicodes[0]).toBe(65);
    expect(layer.contours.length).toBe(0);
  });

  it("applies structural edits echoed by the workspace", async () => {
    const points = await addTriangle(stack, layer);

    expect(layer.contours.at(-1)?.closed).toBe(true);
    expect(points.map((point) => [point.x, point.y])).toEqual([
      [0, 0],
      [100, 0],
      [50, 100],
    ]);
  });

  it("adds a complete cubic segment with a corner endpoint", async () => {
    const contourId = layer.addContour();
    layer.addOnCurvePoint(contourId, { x: 0, y: 0 });
    await stack.editCoordinator.settled();

    const curve = Curve.cubic(
      { x: 0, y: 0 },
      { x: 25, y: 100 },
      { x: 75, y: 100 },
      { x: 100, y: 0 },
    );
    const endpointId = layer.addCubic(contourId, curve);
    await stack.editCoordinator.settled();

    expect(layer.contour(contourId)?.segments()[0]?.asCubic()).toMatchObject({
      start: curve.p0,
      controlStart: curve.c0,
      controlEnd: curve.c1,
      end: { ...curve.p1, id: endpointId, smooth: false },
    });
  });

  it("updates positions synchronously and keeps them after the echo folds", async () => {
    const [first] = await addTriangle(stack, layer);
    layer.applyPositionPatch([{ kind: "point", id: first!.id, x: 25, y: 75 }]);
    expect(renderModel.point(first!.id)).toMatchObject({ x: 25, y: 75 });

    await stack.editCoordinator.settled();
    expect(renderModel.point(first!.id)).toMatchObject({ x: 25, y: 75 });
  });

  it("publishes structural edits before their workspace echo", async () => {
    const contourId = layer.addContour();
    const pointId = layer.addOnCurvePoint(contourId, { x: 10, y: 20 });

    expect(layer.contour(contourId)?.points[0]).toMatchObject({ id: pointId, x: 10, y: 20 });

    await stack.editCoordinator.settled();
    expect(layer.contour(contourId)?.points[0]).toMatchObject({ id: pointId, x: 10, y: 20 });
  });

  it("reverses point metadata and packed coordinates as one contour", async () => {
    const points = await addTriangle(stack, layer);
    const contourId = layer.contours.at(-1)!.id;

    layer.reverseContour(contourId);
    expect(layer.contour(contourId)?.points.map((point) => [point.id, point.x, point.y])).toEqual(
      [...points].reverse().map((point) => [point.id, point.x, point.y]),
    );

    await stack.editCoordinator.settled();
    expect(layer.contour(contourId)?.points.map((point) => point.id)).toEqual(
      [...points].reverse().map((point) => point.id),
    );
  });

  it("publishes deletions before their workspace echo", async () => {
    const [first] = await addTriangle(stack, layer);

    layer.removePoints([first!.id]);
    expect(layer.point(first!.id)).toBeNull();

    await stack.editCoordinator.settled();
    expect(layer.point(first!.id)).toBeNull();
  });

  it("prunes a contour locally when its final points are removed", async () => {
    const points = await addTriangle(stack, layer);
    const contourId = layer.contours.at(-1)!.id;

    layer.removePoints(points.map(({ id }) => id));
    expect(layer.contour(contourId)).toBeNull();

    await stack.editCoordinator.settled();
    expect(layer.contour(contourId)).toBeNull();
  });

  it("publishes advance changes before their workspace echo", async () => {
    layer.setXAdvance(640);
    expect(layer.xAdvance).toBe(640);

    await stack.editCoordinator.settled();
    expect(layer.xAdvance).toBe(640);
  });

  it("targets a newly pending point before its add echo", async () => {
    const contourId = layer.addContour();
    const pointId = layer.addOnCurvePoint(contourId, { x: 10, y: 20 });

    layer.toggleSmooth(pointId);
    expect(layer.point(pointId)?.smooth).toBe(true);

    await stack.editCoordinator.settled();
    expect(layer.point(pointId)?.smooth).toBe(true);
  });

  it("never republishes an older position while rapid edits confirm", async () => {
    const [first] = await addTriangle(stack, layer);
    const observedX: number[] = [];
    const subscription = effect(() => {
      track(layer.buffersChangedCell);
      observedX.push(layer.point(first!.id)?.x ?? NaN);
    });

    layer.movePointTo(first!.id, { x: 10, y: 0 });
    layer.movePointTo(first!.id, { x: 20, y: 0 });
    await stack.editCoordinator.settled();

    expect(observedX).toEqual([0, 10, 20]);
    subscription.dispose();
  });

  it("publishes a transaction as one complete structural state", async () => {
    const pointCounts: number[] = [];
    const subscription = effect(() => {
      pointCounts.push(layer.geometryCell.value.allPoints.length);
    });

    const transactionReads: number[] = [];
    stack.editCoordinator.transaction("Create line", () => {
      const contourId = layer.addContour();
      transactionReads.push(layer.pointCount);
      layer.addOnCurvePoint(contourId, { x: 0, y: 0 });
      transactionReads.push(layer.pointCount);
      layer.addOnCurvePoint(contourId, { x: 100, y: 0 });
      transactionReads.push(layer.pointCount);
    });

    expect(transactionReads).toEqual([0, 1, 2]);
    expect(pointCounts).toEqual([0, 2]);

    await stack.editCoordinator.settled();
    expect(pointCounts.every((count) => count === 0 || count === 2)).toBe(true);
    expect(pointCounts.at(-1)).toBe(2);
    subscription.dispose();
  });

  it("refuses an edit the engine rejects, leaving the layer and the store as they were", async () => {
    const [first] = await addTriangle(stack, layer);
    const otherRecord = stack.font.createGlyphForUnicode(66 as Unicode);
    await stack.editCoordinator.settled();
    const otherGlyph = await stack.font.loadGlyph(otherRecord.id);
    const otherLayer = otherGlyph.layerForSource(stack.font.defaultSource.id);
    if (!otherLayer) throw new Error("Expected second glyph layer");
    const duplicateContourId = otherLayer.addContour();
    await stack.editCoordinator.settled();
    const contours = layer.contours.length;

    expect(() =>
      stack.font.editCoordinator.push({
        kind: "addContour",
        addContour: { layerId: layer.layerId, contourId: duplicateContourId, closed: false },
      }),
    ).toThrow("already exists");
    await stack.editCoordinator.settled();

    expect(layer.contours).toHaveLength(contours);
    const refreshedGlyph = await stack.font.loadGlyph(record.id);
    expect(refreshedGlyph.layerForSource(layer.source.id)?.contours).toHaveLength(contours);
    expect(refreshedGlyph.layerForSource(layer.source.id)?.point(first!.id)).toMatchObject({
      x: 0,
      y: 0,
    });
  });

  it("moves the point it names after points are inserted before it", async () => {
    const [first, second, third] = await addTriangle(stack, layer);
    const inserted = layer.insertPointBefore(second!.id, {
      x: 40,
      y: 0,
      pointType: "onCurve",
      smooth: false,
    });
    layer.movePointTo(second!.id, { x: 110, y: 0 });
    await stack.editCoordinator.settled();

    expect(layer.contours[0]?.points.map((point) => point.id)).toEqual([
      first!.id,
      inserted,
      second!.id,
      third!.id,
    ]);
    expect(layer.point(inserted)).toMatchObject({ x: 40, y: 0 });
    expect(layer.point(second!.id)).toMatchObject({ x: 110, y: 0 });
  });

  it("moves the point it names after earlier points are removed", async () => {
    const [first, second, third] = await addTriangle(stack, layer);
    layer.removePoints([first!.id]);
    layer.movePointTo(third!.id, { x: 60, y: 120 });
    await stack.editCoordinator.settled();

    expect(layer.point(first!.id)).toBeNull();
    expect(layer.point(second!.id)).toMatchObject({ x: 100, y: 0 });
    expect(layer.point(third!.id)).toMatchObject({ x: 60, y: 120 });
  });

  it("moves the point it names after the contour is reversed", async () => {
    const [first, second] = await addTriangle(stack, layer);
    const contourId = layer.contours[0]!.id;
    layer.reverseContour(contourId);
    layer.movePointTo(first!.id, { x: -10, y: 0 });
    await stack.editCoordinator.settled();

    expect(layer.point(first!.id)).toMatchObject({ x: -10, y: 0 });
    expect(layer.point(second!.id)).toMatchObject({ x: 100, y: 0 });
  });

  it("discards every transaction intent when its body throws", async () => {
    expect(() =>
      stack.editCoordinator.transaction("Rejected contour", () => {
        layer.addContour();
        throw new Error("reject edit");
      }),
    ).toThrow("reject edit");

    await stack.editCoordinator.settled();
    expect(layer.contours).toHaveLength(0);
  });

  it("feeds consumers that track source coordinate changes before reading geometry", async () => {
    const [first] = await addTriangle(stack, layer);
    let pointX = first!.x;

    const subscription = effect(() => {
      track(layer.buffersChangedCell);
      pointX = layer.point(first!.id)?.x ?? pointX;
    });

    layer.applyPositionPatch([{ kind: "point", id: first!.id, x: 33, y: 44 }]);

    expect(pointX).toBe(33);
    subscription.dispose();
  });
});

describe("anchors edit through the workspace", () => {
  let stack: WorkspaceStack;
  let layer: GlyphLayer;

  beforeEach(async () => {
    ({ stack, layer } = await startWorkspaceGlyph());
  });

  afterEach(async () => {
    await stack.editCoordinator.settled();
    stack.dispose();
  });

  it("addAnchor is readable before confirmation and remains after its echo", async () => {
    const anchorId = layer.addAnchor("top", { x: 250, y: 700 });
    expect(layer.anchor(anchorId)).toMatchObject({ name: "top", x: 250, y: 700 });

    await stack.editCoordinator.settled();
    const anchor = layer.anchor(anchorId);
    expect(anchor?.name).toBe("top");
    expect(anchor).toMatchObject({ x: 250, y: 700 });
    expect(layer.anchors.length).toBe(1);
  });

  it("commits anchor moves through the moveAnchors intent", async () => {
    const anchorId = layer.addAnchor("top", { x: 250, y: 700 });
    await stack.editCoordinator.settled();

    layer.applyPositionPatch([{ kind: "anchor", id: anchorId, x: 300, y: 650 }]);
    expect(layer.anchor(anchorId)).toMatchObject({ x: 300, y: 650 });

    await stack.editCoordinator.settled();
    expect(layer.anchor(anchorId)).toMatchObject({ x: 300, y: 650 });
  });

  it("mixed point and anchor commits undo as one layer operation", async () => {
    const contourId = layer.addContour();
    layer.addOnCurvePoint(contourId, { x: 0, y: 0 });
    const anchorId = layer.addAnchor("top", { x: 250, y: 700 });
    await stack.editCoordinator.settled();
    const pointId = layer.allPoints[0]!.id;

    layer.applyPositionPatch([
      { kind: "point", id: pointId, x: 10, y: 20 },
      { kind: "anchor", id: anchorId, x: 300, y: 650 },
    ]);
    await stack.editCoordinator.settled();
    expect(layer.point(pointId)).toMatchObject({ x: 10, y: 20 });
    expect(layer.anchor(anchorId)).toMatchObject({ x: 300, y: 650 });

    await stack.editCoordinator.undo();
    expect(layer.point(pointId)).toMatchObject({ x: 0, y: 0 });
    expect(layer.anchor(anchorId)).toMatchObject({ x: 250, y: 700 });
  });

  it("undo removes an added anchor and redo restores it", async () => {
    const anchorId = layer.addAnchor(null, { x: 100, y: 100 });
    await stack.editCoordinator.settled();
    expect(layer.anchors.length).toBe(1);

    await stack.editCoordinator.undo();
    expect(layer.anchors.length).toBe(0);

    await stack.editCoordinator.redo();
    expect(layer.anchor(anchorId)).toMatchObject({ x: 100, y: 100 });
  });

  it("removeAnchors deletes through the workspace", async () => {
    const anchorId = layer.addAnchor("top", { x: 250, y: 700 });
    await stack.editCoordinator.settled();

    layer.removeAnchors([anchorId]);
    expect(layer.anchor(anchorId)).toBeNull();

    await stack.editCoordinator.settled();
    expect(layer.anchors.length).toBe(0);
    expect(layer.anchor(anchorId)).toBeNull();
  });
});

describe("glyph layers keep public geometry coherent across position edits", () => {
  let stack: WorkspaceStack;
  let record: GlyphRecord;
  let layer: GlyphLayer;
  let renderModel: GlyphRenderModel;

  beforeEach(async () => {
    ({ stack, record, layer, renderModel } = await startWorkspaceGlyph());
  });

  afterEach(async () => {
    await stack.editCoordinator.settled();
    stack.dispose();
  });

  it("previews point patches through every public layer geometry view", async () => {
    const [, second] = await addTriangle(stack, layer);

    layer.previewPositionPatch([{ kind: "point", id: second!.id, x: 25, y: 75 }]);

    expect(sourcePosition(layer, second!.id)).toEqual({ x: 25, y: 75 });
    expect(layer.point(second!.id)).toMatchObject({ x: 25, y: 75 });
    expect(layer.contours.at(-1)?.points[1]).toMatchObject({ x: 25, y: 75 });
    expect(layer.allPoints.find((point) => point.id === second!.id)).toMatchObject({
      x: 25,
      y: 75,
    });
    expect(layer.bounds).toEqual(renderModel.bounds);
  });

  it("applies committed point patches to the source and owning glyph geometry", async () => {
    const [, second] = await addTriangle(stack, layer);

    layer.applyPositionPatch([{ kind: "point", id: second!.id, x: 25, y: 75 }]);
    await stack.editCoordinator.settled();

    expect(sourcePosition(layer, second!.id)).toEqual({ x: 25, y: 75 });
    expect(layer.point(second!.id)).toMatchObject({ x: 25, y: 75 });
    expect(renderModel.point(second!.id)).toMatchObject({ x: 25, y: 75 });
  });

  it("commits a preview without double-applying local positions", async () => {
    const [, second] = await addTriangle(stack, layer);

    layer.previewPositionPatch([{ kind: "point", id: second!.id, x: 25, y: 75 }]);
    layer.applyPositionPatch([{ kind: "point", id: second!.id, x: 25, y: 75 }]);
    await stack.editCoordinator.settled();

    expect(sourcePosition(layer, second!.id)).toEqual({ x: 25, y: 75 });
    expect(layer.point(second!.id)).toMatchObject({ x: 25, y: 75 });

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

    expect(layer.point(second!.id)).toMatchObject({ x: 35, y: 80 });
  });

  it("keeps the source-independent RenderGlyph view live", async () => {
    await addTriangle(stack, layer);
    const glyph = stack.store.glyphForId(record.id);
    if (!glyph) throw new Error("Expected Glyph");
    const rendered = new RenderGlyph(glyph.renderModelAt(signal(emptyExternalAxisLocation())));

    layer.setXAdvance(530);
    await stack.editCoordinator.settled();

    expect(rendered.xAdvance).toBe(530);
  });

  it("publishes render advance changes reactively", async () => {
    const glyph = stack.store.glyphForId(record.id);
    if (!glyph) throw new Error("Expected Glyph");
    const renderModel = glyph.renderModelAt(signal(emptyExternalAxisLocation()));
    const observed: number[] = [];
    const subscription = effect(() => {
      observed.push(renderModel.xAdvanceCell.value);
    });

    layer.setXAdvance(530);
    await stack.editCoordinator.settled();

    expect(observed).toEqual([500, 530]);
    subscription.dispose();
  });

  it("keeps source-backed render contours fresh after position edits", async () => {
    const [, second] = await addTriangle(stack, layer);
    const glyph = stack.store.glyphForId(record.id);
    if (!glyph) throw new Error("Expected Glyph");
    const renderModel = glyph.renderModelAt(signal(emptyExternalAxisLocation()));

    layer.applyPositionPatch([{ kind: "point", id: second!.id, x: 25, y: 75 }]);
    await stack.editCoordinator.settled();

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
    const [, second] = await addTriangle(stack, layer);
    const glyph = stack.store.glyphForId(record.id);
    if (!glyph) throw new Error("Expected Glyph");
    const renderModel = glyph.renderModelAt(signal(emptyExternalAxisLocation()));

    expect(
      renderModel.contours.at(-1)?.contour.points.find((point) => point.id === second!.id),
    ).toMatchObject({ x: 100, y: 0 });

    layer.applyPositionPatch([{ kind: "point", id: second!.id, x: 25, y: 75 }]);
    await stack.editCoordinator.settled();

    expect(renderModel.point(second!.id)).toMatchObject({ x: 25, y: 75 });
    expect(
      renderModel.contours.at(-1)?.contour.points.find((point) => point.id === second!.id),
    ).toMatchObject({ x: 25, y: 75 });
  });
});

describe("workspace confirmation preserves unchanged live geometry", () => {
  let stack: WorkspaceStack;
  let layer: GlyphLayer;

  beforeEach(async () => {
    ({ stack, layer } = await startWorkspaceGlyph());
  });

  afterEach(async () => {
    await stack.editCoordinator.settled();
    stack.dispose();
  });

  it("keeps the local geometry when structural edits receive identical echoes", async () => {
    const contourId = layer.addContour();
    const ids = layer.addPoints(contourId, [
      Point.onCurve({ x: 100, y: 200 }),
      Point.onCurve({ x: 300, y: 200 }),
    ]);
    const geometry = layer.geometry;
    await stack.editCoordinator.settled();
    expect(layer.geometry).toBe(geometry);
    expect(layer.contours[0]!.points.map((point) => point.id)).toEqual(ids);
  });

  it("keeps newer local positions while multiple FIFO confirmations drain", async () => {
    const contourId = layer.addContour();
    const ids = layer.addPoints(contourId, [Point.onCurve({ x: 100, y: 200 })]);
    await stack.editCoordinator.settled();
    layer.movePoints(ids, { x: 10, y: 20 });
    layer.movePoints(ids, { x: 30, y: 40 });
    const geometry = layer.geometry;
    await stack.editCoordinator.settled();
    expect(layer.geometry).toBe(geometry);
    expect(layer.point(ids[0]!)).toMatchObject({ x: 140, y: 260 });
  });

  it("still publishes authoritative value changes through undo and redo", async () => {
    const contourId = layer.addContour();
    const ids = layer.addPoints(contourId, [Point.onCurve({ x: 100, y: 200 })]);
    await stack.editCoordinator.settled();
    layer.movePoints(ids, { x: 10, y: 20 });
    await stack.editCoordinator.settled();
    await stack.editCoordinator.undo();
    expect(layer.point(ids[0]!)).toMatchObject({ x: 100, y: 200 });
    await stack.editCoordinator.redo();
    expect(layer.point(ids[0]!)).toMatchObject({ x: 110, y: 220 });
  });
});

describe("point insertion preserves layer ownership", () => {
  let stack: WorkspaceStack;
  let layer: GlyphLayer;

  beforeEach(async () => {
    ({ stack, layer } = await startWorkspaceGlyph());
  });

  afterEach(async () => {
    await stack.editCoordinator.settled();
    stack.dispose();
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

    await stack.editCoordinator.settled();
    expect(layer.contour(contourId)?.points).toMatchObject(
      points.map((point, index) => ({ ...point, id: pointIds[index] })),
    );
    expect(pointIds.map((id) => layer.contourIdOfPoint(id))).toEqual(Array(4).fill(contourId));
  });

  it("does not create an undo entry for an empty insertion", async () => {
    const contourId = layer.addContour();
    await stack.editCoordinator.settled();
    expect(layer.addPoints(contourId, [])).toEqual([]);
    await stack.editCoordinator.settled();

    await stack.editCoordinator.undo();
    expect(layer.contour(contourId)).toBeNull();
  });

  it("removes ownership immediately and restores it through undo and redo", async () => {
    const contourId = layer.addContour();
    const [pointId] = layer.addPoints(contourId, [Point.onCurve({ x: 10, y: 20 })]);
    await stack.editCoordinator.settled();

    layer.removePoints([pointId!]);
    expect(layer.contourIdOfPoint(pointId!)).toBeNull();
    expect(layer.contour(contourId)).toBeNull();
    await stack.editCoordinator.settled();
    await stack.editCoordinator.undo();
    expect(layer.contourIdOfPoint(pointId!)).toBe(contourId);
    expect(layer.positionsFor([{ kind: "point", id: pointId! }])).toMatchObject([{ x: 10, y: 20 }]);
    await stack.editCoordinator.redo();
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
      stack.editCoordinator.transaction("Rejected points", () => {
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

    expect(() => layer.addPointSeeds(otherContourId, [point])).toThrow();
    expect(layer.contourIdOfPoint(pointId!)).toBe(contourId);
    expect(layer.contour(otherContourId)?.points).toEqual([]);
  });

  it("does not reserve point ownership after rejecting an insertion position", () => {
    const contourId = layer.addContour();
    const otherContourId = layer.addContour();
    const [before] = layer.addPoints(otherContourId, [Point.onCurve({ x: 0, y: 0 })]);
    const point = { id: mintPointId(), ...Point.onCurve({ x: 10, y: 20 }) };

    expect(() => layer.addPointSeeds(contourId, [point], before)).toThrow();
    expect(layer.contourIdOfPoint(point.id)).toBeNull();
    layer.addPointSeeds(contourId, [point]);
    expect(layer.contourIdOfPoint(point.id)).toBe(contourId);
    expect(layer.point(point.id)).toMatchObject({ x: 10, y: 20 });
  });
});

describe("GlyphLayer.addComponent with a base not yet loaded this session", () => {
  const outputRoots: string[] = [];

  afterEach(() => {
    for (const root of outputRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  /** Saves a font whose `base` glyph has one contour, then reopens it and loads `root` without loading `base`. */
  async function reopenedWithUnloadedBase(): Promise<{ stack: WorkspaceStack; root: Glyph }> {
    const outputRoot = mkdtempSync(join(tmpdir(), "shift-unloaded-component-"));
    outputRoots.push(outputRoot);
    const savePath = join(outputRoot, "Components.shift");

    const setup = createWorkspaceStack();
    await setup.createWorkspace();
    setup.font.createGlyph("root" as GlyphName);
    const baseRecord = setup.font.createGlyph("base" as GlyphName);
    await setup.editCoordinator.settled();
    const base = await setup.font.loadGlyph(baseRecord.id);
    const baseLayer = base.layerForSource(setup.font.defaultSource.id)!;
    const contourId = baseLayer.addContour();
    baseLayer.addPoint(contourId, Point.onCurve({ x: 0, y: 0 }));
    baseLayer.addPoint(contourId, Point.onCurve({ x: 100, y: 100 }));
    await setup.editCoordinator.save(savePath);
    await setup.closeWorkspace();
    setup.dispose();

    const stack = createWorkspaceStack();
    await stack.openWorkspace(savePath);
    const rootRecord = stack.font.recordForName("root" as GlyphName)!;
    return { stack, root: await stack.font.loadGlyph(rootRecord.id) };
  }

  it("draws the outline of a component added at the layer level once its base loads", async () => {
    const { stack, root } = await reopenedWithUnloadedBase();
    const sourceId = stack.font.defaultSource.id;
    const baseId = stack.font.recordForName("base" as GlyphName)!.id;
    const model = root.renderModelAt(
      signal(emptyExternalAxisLocation()),
      signal<SourceId | null>(sourceId),
    );
    expect(stack.store.glyphForId(baseId)).toBeFalsy();

    root.layerForSource(sourceId)!.addComponent(baseId);
    await stack.editCoordinator.settled();

    await expect.poll(() => model.contours.length).toBe(1);
    expect(model.components).toHaveLength(1);
    stack.dispose();
  });
});
