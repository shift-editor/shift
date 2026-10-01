import { beforeEach, describe, expect, it } from "vitest";
import { Mat, Vec2, type Rect2D } from "@shift/geo";
import { Point } from "@shift/glyph-state";
import type { AxisId, ComponentId, GlyphName, SourceId } from "@shift/types";
import { externalAxisLocationFromRecord } from "@shift/editor/variation";
import { TestEditor } from "@/testing/TestEditor";
import type { ComponentTransformSelection } from "@shift/editor/types";
import type { GlyphLayer } from "@shift/editor/model";

describe("multi-source component transform edits", () => {
  let editor: TestEditor;
  let axisId: AxisId;
  let referenceSourceId: SourceId;
  let targetSourceId: SourceId;
  let referenceLayer: GlyphLayer;
  let targetLayer: GlyphLayer;
  let referenceComponentId: ComponentId;
  let targetComponentId: ComponentId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    await editor.addGlyph("component-transform-base", null);
    const record = editor.font.recordForName("component-transform-base" as GlyphName);
    if (!record) throw new Error("Expected component base glyph");

    const base = await editor.font.loadGlyph(record.id);
    const baseLayer = base.layerForSource(editor.font.defaultSource.id);
    if (!baseLayer) throw new Error("Expected component base layer");

    const contourId = baseLayer.addContour();
    for (const position of [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]) {
      baseLayer.addPoint(contourId, Point.onCurve(position));
    }
    baseLayer.closeContour(contourId);

    referenceLayer = editor.requireGlyphLayer();
    referenceComponentId = referenceLayer.addComponent(record.id);
    await editor.settle();

    referenceSourceId = editor.font.defaultSource.id;
    axisId = editor.font.createAxis(weightAxis());
    await editor.settle();
    targetSourceId = editor.createSource("Bold", externalAxisLocationFromRecord({ [axisId]: 700 }));
    await editor.settle();

    editor.selectSourceForEditing(referenceSourceId);
    editor.selectSourceForEditing(targetSourceId, "toggle");
    await expect.poll(() => editor.editingLayerMatchesCell.peek().size).toBe(1);

    const selection = requireSelection(editor, referenceComponentId);
    const target = selection.additionalLayers[0];
    if (!target) throw new Error("Expected matched component layer");

    targetLayer = target.layer;
    const targetId = target.componentIds[0];
    if (!targetId) throw new Error("Expected matched component");
    targetComponentId = targetId;
  });

  it("moves every matched component and discards every preview", () => {
    const selection = requireSelection(editor, referenceComponentId);
    const edit = selection.layer.beginComponentTransformEdit(selection);

    edit.preview(() => Mat.Translate(20, -10));
    expect(componentTransform(referenceLayer, referenceComponentId)).toMatchObject({
      translateX: 20,
      translateY: -10,
    });
    expect(componentTransform(targetLayer, targetComponentId)).toMatchObject({
      translateX: 20,
      translateY: -10,
    });

    edit.discard();
    expect(componentTransform(referenceLayer, referenceComponentId)).toMatchObject({
      translateX: 0,
      translateY: 0,
    });
    expect(componentTransform(targetLayer, targetComponentId)).toMatchObject({
      translateX: 0,
      translateY: 0,
    });
  });

  it("scales around corresponding source pivots and undoes every source atomically", async () => {
    offsetTargetComponent();
    await editor.settle();

    const selection = requireSelection(editor, referenceComponentId);
    selection.layer.transformComponents(selection, "Scale components", (layer) =>
      scaleAroundCenter(layer.bounds, 2),
    );
    await editor.settle();

    const reference = componentTransform(referenceLayer, referenceComponentId);
    const target = componentTransform(targetLayer, targetComponentId);
    expect(reference.scaleX).toBeCloseTo(2);
    expect(reference.scaleY).toBeCloseTo(2);
    expect(target.scaleX).toBeCloseTo(2);
    expect(target.scaleY).toBeCloseTo(2);
    expect(target.translateX - reference.translateX).toBeCloseTo(100);
    expect(target.translateY - reference.translateY).toBeCloseTo(50);

    await editor.undo();
    expect(componentTransform(referenceLayer, referenceComponentId)).toMatchObject({
      translateX: 0,
      translateY: 0,
      scaleX: 1,
      scaleY: 1,
    });
    expect(componentTransform(targetLayer, targetComponentId)).toMatchObject({
      translateX: 100,
      translateY: 50,
      scaleX: 1,
      scaleY: 1,
    });

    await editor.redo();
    expect(componentTransform(referenceLayer, referenceComponentId).scaleX).toBeCloseTo(2);
    expect(componentTransform(targetLayer, targetComponentId).scaleX).toBeCloseTo(2);
  });

  it("rotates every source around its corresponding component center", async () => {
    offsetTargetComponent();
    await editor.settle();

    const selection = requireSelection(editor, referenceComponentId);
    const edit = selection.layer.beginComponentTransformEdit(selection);
    edit.preview((layer) => rotateAroundCenter(layer.bounds, Math.PI / 2));

    const reference = componentTransform(referenceLayer, referenceComponentId);
    const target = componentTransform(targetLayer, targetComponentId);
    expect(reference.rotation).toBeCloseTo(90);
    expect(target.rotation).toBeCloseTo(90);
    expect(target.translateX - reference.translateX).toBeCloseTo(100);
    expect(target.translateY - reference.translateY).toBeCloseTo(50);

    edit.discard();
  });

  it("releases every source edit when a one-shot transform fails", () => {
    const selection = requireSelection(editor, referenceComponentId);

    expect(() =>
      selection.layer.transformComponents(selection, "Move components", () => {
        throw new Error("invalid transform");
      }),
    ).toThrow("invalid transform");

    const nextEdit = selection.layer.beginComponentTransformEdit(selection);
    nextEdit.discard();
  });

  it("refuses a transform when any editing source lacks a complete component match", async () => {
    const record = editor.font.recordForName("component-transform-base" as GlyphName);
    if (!record) throw new Error("Expected component base glyph");

    targetLayer.addComponent(record.id);
    await editor.settle();
    await expect
      .poll(() => [...editor.editingLayerMatchesCell.peek().values()][0]?.complete)
      .toBe(false);

    expect(editor.componentTransformSelection([referenceComponentId])).toBeNull();
    expect(componentTransform(referenceLayer, referenceComponentId)).toMatchObject({
      translateX: 0,
      translateY: 0,
    });
  });

  function offsetTargetComponent(): void {
    const transform = componentTransform(targetLayer, targetComponentId);
    targetLayer.transaction("Offset target component", () => {
      targetLayer.setComponentTransforms(
        [targetComponentId],
        [{ ...transform, translateX: 100, translateY: 50 }],
      );
    });
  }
});

function requireSelection(
  editor: TestEditor,
  componentId: ComponentId,
): ComponentTransformSelection {
  const selection = editor.componentTransformSelection([componentId]);
  if (!selection) throw new Error("Expected matched component selection");

  return selection;
}

function componentTransform(layer: GlyphLayer, componentId: ComponentId) {
  const component = layer.components.find(({ id }) => id === componentId);
  if (!component) throw new Error("Expected component");

  return component.transform;
}

function scaleAroundCenter(bounds: Rect2D, scaleFactor: number) {
  const center = rectCenter(bounds);
  return Mat.Compose(
    Mat.Translate(center.x, center.y),
    Mat.Compose(Mat.Scale(scaleFactor, scaleFactor), Mat.Translate(-center.x, -center.y)),
  );
}

function rotateAroundCenter(bounds: Rect2D, angle: number) {
  const center = rectCenter(bounds);
  return Mat.Compose(
    Mat.Translate(center.x, center.y),
    Mat.Compose(Mat.Rotate(angle), Mat.Translate(-center.x, -center.y)),
  );
}

function rectCenter(bounds: Rect2D) {
  return Vec2.midpoint({ x: bounds.left, y: bounds.top }, { x: bounds.right, y: bounds.bottom });
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
