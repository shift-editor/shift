import { beforeEach, describe, expect, it } from "vitest";
import { Vec2 } from "@shift/geo";
import { Point } from "@shift/glyph-state";
import type { PointId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";
import { AngleSnap } from "./AngleSnap";
import { DirectionSnap } from "./DirectionSnap";
import { MetricSnap } from "./MetricSnap";
import { PointRuleConstraint } from "./PointRuleConstraint";
import { PositionReference } from "./PositionReference";

// These tests exercise the model surface directly; SelectMove.test.ts covers its tool integration.
describe("fluent position edits preserve one frozen interaction base", () => {
  let editor: TestEditor;
  let pointId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    await editor.clickGlyphLocal(100, 100);
    pointId = editor.requireGlyphLayer().allPoints[0]!.id;
  });

  it("recomputes movement previews from the original position and discards them", () => {
    const edit = editor.requireGlyphLayer().positions.move({ points: [pointId] });

    edit.preview({ x: 10, y: 0 });
    edit.preview({ x: 25, y: 0 });
    expect(editor.pointPosition(pointId)).toEqual({ x: 125, y: 100 });

    edit.discard();
    expect(editor.pointPosition(pointId)).toEqual({ x: 100, y: 100 });
  });

  it("commits one preview through the workspace ledger and undoes it", async () => {
    const edit = editor.requireGlyphLayer().positions.move({ points: [pointId] });

    edit.preview({ x: 25, y: -10 });
    edit.commit();
    await editor.settle();
    expect(editor.pointPosition(pointId)).toEqual({ x: 125, y: 90 });

    await editor.undo();
    expect(editor.pointPosition(pointId)).toEqual({ x: 100, y: 100 });
  });

  it("discards structural changes with movement scoped within their layer edit", () => {
    const layer = editor.requireGlyphLayer();
    const layerEdit = layer.beginEdit();
    const contourId = layerEdit.addContour(false);
    const [addedPointId] = layerEdit.addPoints(contourId, [Point.onCurve({ x: 200, y: 100 })]);
    if (!addedPointId) throw new Error("Expected added point");
    const move = layer.positions.within(layerEdit).move({ points: [addedPointId] });

    move.preview({ x: 25, y: -10 });
    expect(editor.pointPosition(addedPointId)).toEqual({ x: 225, y: 90 });
    move.discard();
    expect(layer.contour(contourId)).toBeNull();
  });

  it("commits structural changes and movement as one undoable scoped edit", async () => {
    const layer = editor.requireGlyphLayer();
    const layerEdit = layer.beginEdit();
    const contourId = layerEdit.addContour(false);
    const [addedPointId] = layerEdit.addPoints(contourId, [Point.onCurve({ x: 200, y: 100 })]);
    if (!addedPointId) throw new Error("Expected added point");
    const move = layer.positions.within(layerEdit).move({ points: [addedPointId] });

    move.preview({ x: 25, y: -10 });
    move.commit();
    await editor.settle();
    expect(editor.pointPosition(addedPointId)).toEqual({ x: 225, y: 90 });

    await editor.undo();
    expect(layer.contour(contourId)).toBeNull();
  });

  it("applies direction snapping before point rules", () => {
    const layer = editor.requireGlyphLayer();
    const edit = layer.positions
      .move({ points: [pointId] })
      .from(PositionReference.point(pointId))
      .directionSnappedBy(DirectionSnap.everyDegrees(45))
      .constrainedBy(PointRuleConstraint.forSelection(layer.geometry, [pointId]));

    const feedback = edit.preview({ x: 10, y: 6 });
    const component = Vec2.len({ x: 10, y: 6 }) / Math.sqrt(2);

    expect(feedback.delta.x).toBeCloseTo(component);
    expect(feedback.delta.y).toBeCloseTo(component);
    expect(feedback.guides[0]?.kind).toBe("direction");
    edit.discard();
  });

  it("snaps the explicit reference to source metrics", () => {
    const layer = editor.requireGlyphLayer();
    const metrics = { ...editor.font.metricsForSource(layer.sourceId), xHeight: 500 };
    const edit = layer.positions
      .move({ points: [pointId] })
      .from(PositionReference.point(pointId))
      .snappedBy(MetricSnap.standard(metrics, 8));

    const feedback = edit.preview({ x: 20, y: 397 });

    expect(feedback.delta).toEqual({ x: 20, y: 400 });
    expect(editor.pointPosition(pointId)).toEqual({ x: 120, y: 500 });
    expect(feedback.guides).toEqual([{ kind: "metric", metric: "xHeight", y: 500 }]);
    edit.discard();
  });

  it("scales from one frozen layer-local origin and discards the preview", () => {
    const edit = editor.requireGlyphLayer().positions.scale({ points: [pointId] }, { x: 0, y: 0 });

    edit.preview({ x: 2, y: 0.5 });
    expect(editor.pointPosition(pointId)).toEqual({ x: 200, y: 50 });

    edit.discard();
    expect(editor.pointPosition(pointId)).toEqual({ x: 100, y: 100 });
  });

  it("quantizes rotation independently from movement modifiers", () => {
    const edit = editor
      .requireGlyphLayer()
      .positions.rotate({ points: [pointId] }, { x: 0, y: 0 })
      .angleSnappedBy(AngleSnap.everyDegrees(15));

    const angle = edit.preview((44 * Math.PI) / 180);

    expect(angle).toBeCloseTo(Math.PI / 4);
    expect(editor.pointPosition(pointId).x).toBeCloseTo(0);
    expect(editor.pointPosition(pointId).y).toBeCloseTo(Math.sqrt(20_000));
    edit.discard();
  });

  it("rejects configuration after preview and preview after completion", () => {
    const edit = editor.requireGlyphLayer().positions.move({ points: [pointId] });

    edit.preview({ x: 10, y: 0 });
    expect(() => edit.from(PositionReference.point(pointId))).toThrow(/before the first preview/);

    edit.discard();
    expect(() => edit.preview({ x: 20, y: 0 })).toThrow(/completed position edit/);
  });
});
