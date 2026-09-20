import { beforeEach, describe, expect, it } from "vitest";
import { Point } from "@shift/glyph-state";
import type { AnchorId, AxisId, PointId, SourceId } from "@shift/types";
import { externalAxisLocationFromRecord } from "@shift/editor/lib/variation/location";
import type { GlyphLayer } from "@shift/editor/lib/model/Glyph";
import { TestEditor } from "@/testing/TestEditor";
import type { SelectableId } from "@shift/editor/types/object";
import type { PositionSelection } from "@shift/editor/types/positionEdit";
import { PositionEdits } from "@shift/editor/lib/model/positions/PositionEdits";

describe("multi-source position edits", () => {
  let editor: TestEditor;
  let axisId: AxisId;
  let referenceSourceId: SourceId;
  let targetSourceId: SourceId;
  let anchorId: AnchorId;
  let firstId: PointId;
  let lastId: PointId;
  let targetLayer: GlyphLayer;
  let targetFirstId: PointId;
  let targetLastId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    [firstId, , lastId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 150, y: 150 },
      { x: 200, y: 200 },
    ]);
    anchorId = editor.requireGlyphLayer().addAnchor("top", { x: 150, y: 250 });
    await editor.settle();
    referenceSourceId = editor.font.defaultSource.id;
    axisId = editor.font.createAxis(weightAxis());
    await editor.settle();
    targetSourceId = editor.createSource("Bold", externalAxisLocationFromRecord({ [axisId]: 700 }));
    await editor.settle();
    editor.selectSourceForEditing(referenceSourceId);
    editor.selectSourceForEditing(targetSourceId, "toggle");
    await expect.poll(() => editor.editingLayerMatchesCell.peek().size).toBe(1);

    const selection = requirePositionSelection(editor, [firstId, lastId]);
    const targetSelection = selection.additionalLayers[0];
    if (!targetSelection) throw new Error("Expected matched target layer");
    const [firstTarget, lastTarget] = targetSelection.targets.points ?? [];
    if (!firstTarget || !lastTarget) throw new Error("Expected matched target points");
    targetLayer = targetSelection.layer;
    targetFirstId = firstTarget;
    targetLastId = lastTarget;
  });

  it("moves matched anchors and discards every source preview", () => {
    const selection = requirePositionSelection(editor, [anchorId]);
    const targetSelection = selection.additionalLayers[0];
    const targetAnchorId = targetSelection?.targets.anchors?.[0];
    if (!targetSelection || !targetAnchorId) throw new Error("Expected matched target anchor");
    const move = PositionEdits.fromSelection(selection).move(selection.targets);

    move.preview({ x: 20, y: -10 });
    expect(editor.anchorPosition(anchorId)).toEqual({ x: 170, y: 240 });
    expect(anchorPosition(targetSelection.layer, targetAnchorId)).toEqual({ x: 170, y: 240 });

    move.discard();
    expect(editor.anchorPosition(anchorId)).toEqual({ x: 150, y: 250 });
    expect(anchorPosition(targetSelection.layer, targetAnchorId)).toEqual({ x: 150, y: 250 });
  });

  it("scales each source around its corresponding pivot and undoes both atomically", async () => {
    const targetOffset = targetLayer.positions.move({ points: [targetFirstId, targetLastId] });
    targetOffset.preview({ x: 100, y: 50 });
    targetOffset.commit();
    await editor.settle();

    const selection = requirePositionSelection(editor, [firstId, lastId]);
    const scale = PositionEdits.fromSelection(selection).scale(selection.targets, {
      x: 150,
      y: 150,
    });
    scale.preview({ x: 2, y: 1 });

    expect(editor.pointPosition(firstId)).toEqual({ x: 50, y: 100 });
    expect(pointPosition(targetLayer, targetFirstId)).toEqual({ x: 150, y: 150 });

    scale.commit();
    await editor.settle();
    await editor.undo();

    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
    expect(pointPosition(targetLayer, targetFirstId)).toEqual({ x: 200, y: 150 });
  });

  it("rotates around corresponding pivots and discards every source preview", async () => {
    const targetOffset = targetLayer.positions.move({ points: [targetFirstId, targetLastId] });
    targetOffset.preview({ x: 100, y: 50 });
    targetOffset.commit();
    await editor.settle();

    const selection = requirePositionSelection(editor, [firstId, lastId]);
    const rotate = PositionEdits.fromSelection(selection).rotate(selection.targets, {
      x: 150,
      y: 150,
    });
    rotate.preview(Math.PI / 2);

    const referencePreview = editor.pointPosition(firstId);
    expect(pointPosition(targetLayer, targetFirstId)).toEqual({
      x: referencePreview.x + 100,
      y: referencePreview.y + 50,
    });

    rotate.discard();
    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
    expect(pointPosition(targetLayer, targetFirstId)).toEqual({ x: 200, y: 150 });
  });

  it("publishes only matches for the latest editing source set", async () => {
    const blackSourceId = editor.createSource(
      "Black",
      externalAxisLocationFromRecord({ [axisId]: 900 }),
    );
    await editor.settle();
    editor.selectSourceForEditing(referenceSourceId);
    editor.selectSourceForEditing(targetSourceId, "toggle");
    editor.selectSourceForEditing(blackSourceId, "toggle");
    editor.selectSourceForEditing(targetSourceId, "toggle");

    const node = editor.glyphNode;
    if (!node) throw new Error("Expected glyph node");
    const blackLayerId = editor.glyphForId(node.glyphId)?.layerForSource(blackSourceId)?.id;
    if (!blackLayerId) throw new Error("Expected Black source layer");
    await expect
      .poll(() => [...editor.editingLayerMatchesCell.peek().keys()])
      .toEqual([blackLayerId]);
  });

  it("invalidates complete mappings after a target structure change", async () => {
    const contour = targetLayer.contours[0];
    if (!contour) throw new Error("Expected target contour");
    const edit = targetLayer.beginEdit();
    edit.addPoints(contour.id, [Point.onCurve({ x: 250, y: 250 })]);
    edit.finish("Add point");
    await editor.settle();

    await expect
      .poll(() => [...editor.editingLayerMatchesCell.peek().values()][0]?.complete)
      .toBe(false);
    expect(editor.positionSelection([firstId, lastId])).toBeNull();
  });
});

function requirePositionSelection(
  editor: TestEditor,
  ids: readonly SelectableId[],
): PositionSelection {
  const selection = editor.positionSelection(ids);
  if (!selection) throw new Error("Expected position selection");

  return selection;
}

function pointPosition(layer: GlyphLayer, pointId: PointId) {
  const point = layer.point(pointId);
  if (!point) throw new Error("Expected layer point");

  return { x: point.x, y: point.y };
}

function anchorPosition(layer: GlyphLayer, anchorId: AnchorId) {
  const anchor = layer.anchor(anchorId);
  if (!anchor) throw new Error("Expected layer anchor");

  return { x: anchor.x, y: anchor.y };
}

function weightAxis() {
  return {
    tag: "wght",
    name: "Weight",
    role: "external" as const,
    axisType: "continuous" as const,
    minimum: 100,
    default: 400,
    maximum: 900,
    labels: [],
    hidden: false,
  };
}
