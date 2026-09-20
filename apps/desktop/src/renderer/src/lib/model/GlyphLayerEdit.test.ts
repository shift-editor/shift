import { beforeEach, describe, expect, it } from "vitest";
import { Point } from "@shift/glyph-state";
import type { ContourId, GlyphState, LayerId, PointId, Source, SourceId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";
import { GlyphLayer } from "@shift/editor/model";
import { GlyphLayerState } from "@shift/editor/model";

describe("local glyph layer position edits", () => {
  it("retains a finished position edit without a workspace", () => {
    const pointId = "point-memory" as PointId;
    const initialState: GlyphState = {
      layerId: "layer-memory" as LayerId,
      structure: {
        contours: [
          {
            id: "contour-memory" as ContourId,
            closed: false,
            points: [{ id: pointId, pointType: "onCurve", smooth: false }],
          },
        ],
        anchors: [],
        components: [],
      },
      values: new Float64Array([500, 100, 100]),
    };
    const state = new GlyphLayerState(initialState);
    const source: Source = {
      id: "source-memory" as SourceId,
      name: "Regular",
      location: { values: {} },
      metricValues: [],
    };
    const layer = new GlyphLayer(source, null, state);

    const edit = layer.beginEdit();
    edit.setPositions([{ kind: "point", id: pointId, x: 175, y: 125 }]);
    edit.finish("Move point");

    expect(layer.point(pointId)).toMatchObject({ x: 175, y: 125 });

    const canceled = layer.beginEdit();
    canceled.setPositions([{ kind: "point", id: pointId, x: 250, y: 200 }]);
    canceled.cancel();

    expect(layer.point(pointId)).toMatchObject({ x: 175, y: 125 });
  });
});

describe("glyph layer edits preserve committed preview bases", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    await editor.clickGlyphLocal(100, 100);
    await editor.clickGlyphLocal(300, 200);
  });

  it("adds contours, points, and anchors locally and cancels them together", () => {
    const layer = editor.requireGlyphLayer();
    const edit = layer.beginEdit();
    const contourId = edit.addContour(true);
    const [pointId] = edit.addPoints(contourId, [Point.onCurve({ x: 400, y: 300 })]);
    const anchorId = edit.addAnchor("top", { x: 400, y: 700 });

    expect(layer.contour(contourId)?.closed).toBe(true);
    expect(layer.point(pointId!)).toMatchObject({ x: 400, y: 300 });
    expect(layer.anchor(anchorId)).toMatchObject({ name: "top", x: 400, y: 700 });

    edit.cancel();
    expect(layer.contour(contourId)).toBeNull();
    expect(layer.point(pointId!)).toBeNull();
    expect(layer.anchor(anchorId)).toBeNull();
  });

  it("finishes structural additions as one undoable edit", async () => {
    const layer = editor.requireGlyphLayer();
    const edit = layer.beginEdit();
    const contourId = edit.addContour(true);
    const [pointId] = edit.addPoints(contourId, [
      Point.onCurve({ x: 400, y: 300 }),
      Point.onCurve({ x: 500, y: 300 }),
    ]);
    const anchorId = edit.addAnchor("top", { x: 400, y: 700 });
    edit.finish("Add contour and anchor");
    await editor.settle();
    expect(layer.contour(contourId)?.closed).toBe(true);
    expect(layer.point(pointId!)).toMatchObject({ x: 400, y: 300 });
    expect(layer.anchor(anchorId)).toMatchObject({ x: 400, y: 700 });

    await editor.undo();
    expect(layer.point(pointId!)).toBeNull();
    expect(layer.anchor(anchorId)).toBeNull();

    await editor.redo();
    expect(layer.contour(contourId)?.closed).toBe(true);
    expect(layer.point(pointId!)).toMatchObject({ x: 400, y: 300 });
    expect(layer.anchor(anchorId)).toMatchObject({ x: 400, y: 700 });
  });

  it("reapplies structural additions over an older workspace echo", async () => {
    const layer = editor.requireGlyphLayer();
    const acceptedContourId = layer.addContour();
    const edit = layer.beginEdit();
    const previewContourId = edit.addContour(false);
    const [previewPointId] = edit.addPoints(previewContourId, [Point.onCurve({ x: 400, y: 300 })]);

    await editor.settle();
    expect(layer.contour(acceptedContourId)).not.toBeNull();
    expect(layer.point(previewPointId!)).toMatchObject({ x: 400, y: 300 });

    edit.cancel();
    expect(layer.contour(acceptedContourId)).not.toBeNull();
    expect(layer.contour(previewContourId)).toBeNull();
  });

  it("previews, finishes, and undoes through the workspace ledger", async () => {
    const layer = editor.requireGlyphLayer();
    const pointId = layer.allPoints[0]!.id;
    const edit = layer.beginEdit();

    edit.setPositions([{ kind: "point", id: pointId, x: 125, y: 90 }]);
    expect(editor.pointPosition(pointId)).toEqual({ x: 125, y: 90 });

    edit.finish("Move point");
    await editor.settle();
    expect(editor.pointPosition(pointId)).toEqual({ x: 125, y: 90 });

    await editor.undo();
    expect(editor.pointPosition(pointId)).toEqual({ x: 100, y: 100 });
  });

  it("cancels every previewed position in an arbitrary patch", () => {
    const layer = editor.requireGlyphLayer();
    const [first, second] = layer.allPoints;
    const edit = layer.beginEdit();

    edit.setPositions([
      { kind: "point", id: first!.id, x: 110, y: 100 },
      { kind: "point", id: second!.id, x: 320, y: 200 },
    ]);
    edit.cancel();

    expect(editor.pointPosition(first!.id)).toEqual({ x: 100, y: 100 });
    expect(editor.pointPosition(second!.id)).toEqual({ x: 300, y: 200 });
  });

  it("uses every position in a finished patch as the next cancellation base", async () => {
    const layer = editor.requireGlyphLayer();
    const [first, second] = layer.allPoints;
    const firstEdit = layer.beginEdit();
    firstEdit.setPositions([
      { kind: "point", id: first!.id, x: 110, y: 100 },
      { kind: "point", id: second!.id, x: 320, y: 200 },
    ]);
    firstEdit.finish("Expanded move");
    await editor.settle();

    const secondEdit = layer.beginEdit();
    secondEdit.setPositions([
      { kind: "point", id: first!.id, x: 130, y: 100 },
      { kind: "point", id: second!.id, x: 340, y: 200 },
    ]);
    secondEdit.cancel();

    expect([editor.pointPosition(first!.id), editor.pointPosition(second!.id)]).toEqual([
      { x: 110, y: 100 },
      { x: 320, y: 200 },
    ]);
  });
});
