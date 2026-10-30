import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Point } from "@shift/glyph-state";
import type { GlyphLayer } from "@shift/editor/model";
import { drawPoints, startWorkspaceGlyph, type WorkspaceStack } from "@/testing/workspaceStack";

describe("glyph layer edits preserve committed preview bases", () => {
  let stack: WorkspaceStack;
  let layer: GlyphLayer;

  beforeEach(async () => {
    ({ stack, layer } = await startWorkspaceGlyph());
    drawPoints(layer, [
      { x: 100, y: 100 },
      { x: 300, y: 200 },
    ]);
    await stack.editCoordinator.settled();
  });

  afterEach(async () => {
    await stack.editCoordinator.settled();
    stack.dispose();
  });

  it("adds contours, points, and anchors locally and cancels them together", () => {
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
    const edit = layer.beginEdit();
    const contourId = edit.addContour(true);
    const [pointId] = edit.addPoints(contourId, [
      Point.onCurve({ x: 400, y: 300 }),
      Point.onCurve({ x: 500, y: 300 }),
    ]);
    const anchorId = edit.addAnchor("top", { x: 400, y: 700 });
    edit.finish("Add contour and anchor");
    await stack.editCoordinator.settled();
    expect(layer.contour(contourId)?.closed).toBe(true);
    expect(layer.point(pointId!)).toMatchObject({ x: 400, y: 300 });
    expect(layer.anchor(anchorId)).toMatchObject({ x: 400, y: 700 });

    await stack.editCoordinator.undo();
    expect(layer.point(pointId!)).toBeNull();
    expect(layer.anchor(anchorId)).toBeNull();

    await stack.editCoordinator.redo();
    expect(layer.contour(contourId)?.closed).toBe(true);
    expect(layer.point(pointId!)).toMatchObject({ x: 400, y: 300 });
    expect(layer.anchor(anchorId)).toMatchObject({ x: 400, y: 700 });
  });

  it("reapplies structural additions over an older workspace echo", async () => {
    const acceptedContourId = layer.addContour();
    const edit = layer.beginEdit();
    const previewContourId = edit.addContour(false);
    const [previewPointId] = edit.addPoints(previewContourId, [Point.onCurve({ x: 400, y: 300 })]);

    await stack.editCoordinator.settled();
    expect(layer.contour(acceptedContourId)).not.toBeNull();
    expect(layer.point(previewPointId!)).toMatchObject({ x: 400, y: 300 });
    expect(layer.contourIdOfPoint(previewPointId!)).toBe(previewContourId);

    edit.cancel();
    expect(layer.contour(acceptedContourId)).not.toBeNull();
    expect(layer.contour(previewContourId)).toBeNull();
    expect(layer.contourIdOfPoint(previewPointId!)).toBeNull();
  });

  it("previews, finishes, and undoes through the workspace ledger", async () => {
    const pointId = layer.allPoints[0]!.id;
    const edit = layer.beginEdit();

    edit.setPositions([{ kind: "point", id: pointId, x: 125, y: 90 }]);
    expect(layer.point(pointId)).toMatchObject({ x: 125, y: 90 });

    edit.finish("Move point");
    await stack.editCoordinator.settled();
    expect(layer.point(pointId)).toMatchObject({ x: 125, y: 90 });

    await stack.editCoordinator.undo();
    expect(layer.point(pointId)).toMatchObject({ x: 100, y: 100 });
  });

  it("cancels every previewed position in an arbitrary patch", () => {
    const [first, second] = layer.allPoints;
    const edit = layer.beginEdit();

    edit.setPositions([
      { kind: "point", id: first!.id, x: 110, y: 100 },
      { kind: "point", id: second!.id, x: 320, y: 200 },
    ]);
    edit.cancel();

    expect(layer.point(first!.id)).toMatchObject({ x: 100, y: 100 });
    expect(layer.point(second!.id)).toMatchObject({ x: 300, y: 200 });
  });

  it("uses every position in a finished patch as the next cancellation base", async () => {
    const [first, second] = layer.allPoints;
    const firstEdit = layer.beginEdit();
    firstEdit.setPositions([
      { kind: "point", id: first!.id, x: 110, y: 100 },
      { kind: "point", id: second!.id, x: 320, y: 200 },
    ]);
    firstEdit.finish("Expanded move");
    await stack.editCoordinator.settled();

    const secondEdit = layer.beginEdit();
    secondEdit.setPositions([
      { kind: "point", id: first!.id, x: 130, y: 100 },
      { kind: "point", id: second!.id, x: 340, y: 200 },
    ]);
    secondEdit.cancel();

    expect(layer.point(first!.id)).toMatchObject({ x: 110, y: 100 });
    expect(layer.point(second!.id)).toMatchObject({ x: 320, y: 200 });
  });
});
