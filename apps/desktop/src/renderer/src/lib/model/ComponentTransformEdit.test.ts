import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Mat, Rect, Vec2, type Rect2D } from "@shift/geo";
import type { ComponentId } from "@shift/types";
import { externalAxisLocationFromRecord } from "@shift/editor/variation";
import type {
  ComponentTransformSelection,
  ComponentTransformSelectionLayer,
} from "@shift/editor/types";
import type { GlyphLayer } from "@shift/editor/model";
import { square } from "@/testing/fixtures";
import { startEditorWith, WEIGHT } from "@/testing/fontFixture";
import type { EditorTestSurface } from "@/testing/surface";
import {
  addWorkspaceGlyph,
  drawPoints,
  startWorkspaceGlyph,
  type WorkspaceStack,
} from "@/testing/workspaceStack";

/** The base glyph's outline: a 100-unit square at the origin, so a component covers it at its offset. */
const BASE_SIZE = 100;

describe("multi-source component transform edits", () => {
  let stack: WorkspaceStack;
  let referenceLayer: GlyphLayer;
  let targetLayer: GlyphLayer;
  let referenceComponentId: ComponentId;
  let targetComponentId: ComponentId;

  beforeEach(async () => {
    const started = await startWorkspaceGlyph();
    ({ stack, layer: referenceLayer } = started);
    const glyphRecord = started.record;
    const glyph = started.glyph;
    const { record: baseRecord, layer: baseLayer } = await addWorkspaceGlyph(
      stack,
      "component-transform-base",
    );
    drawPoints(
      baseLayer,
      [
        { x: 0, y: 0 },
        { x: BASE_SIZE, y: 0 },
        { x: BASE_SIZE, y: BASE_SIZE },
        { x: 0, y: BASE_SIZE },
      ],
      { closed: true },
    );

    referenceComponentId = referenceLayer.addComponent(baseRecord.id);
    await stack.editCoordinator.settled();

    const axisId = stack.font.createAxis(weightAxis());
    await stack.editCoordinator.settled();
    const targetSourceId = stack.font.createSource(
      "Bold",
      externalAxisLocationFromRecord({ [axisId]: 700 }),
    );
    await stack.editCoordinator.settled();
    stack.font.createGlyphLayer(glyphRecord.id, targetSourceId);
    await stack.editCoordinator.settled();

    const target = glyph.layerForSource(targetSourceId);
    if (!target) throw new Error("Expected matched component layer");
    targetLayer = target;
    targetComponentId = targetLayer.addComponent(baseRecord.id);
    await stack.editCoordinator.settled();
  });

  afterEach(async () => {
    await stack.editCoordinator.settled();
    stack.dispose();
  });

  it("moves every matched component and discards every preview", () => {
    const selection = matchedSelection();
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
    await stack.editCoordinator.settled();

    const selection = matchedSelection();
    selection.layer.transformComponents(selection, "Scale components", (layer) =>
      scaleAroundCenter(layer.bounds, 2),
    );
    await stack.editCoordinator.settled();

    const reference = componentTransform(referenceLayer, referenceComponentId);
    const target = componentTransform(targetLayer, targetComponentId);
    expect(reference.scaleX).toBeCloseTo(2);
    expect(reference.scaleY).toBeCloseTo(2);
    expect(target.scaleX).toBeCloseTo(2);
    expect(target.scaleY).toBeCloseTo(2);
    expect(target.translateX - reference.translateX).toBeCloseTo(100);
    expect(target.translateY - reference.translateY).toBeCloseTo(50);

    await stack.editCoordinator.undo();
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

    await stack.editCoordinator.redo();
    expect(componentTransform(referenceLayer, referenceComponentId).scaleX).toBeCloseTo(2);
    expect(componentTransform(targetLayer, targetComponentId).scaleX).toBeCloseTo(2);
  });

  it("rotates every source around its corresponding component center", async () => {
    offsetTargetComponent();
    await stack.editCoordinator.settled();

    const selection = matchedSelection();
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
    const selection = matchedSelection();

    expect(() =>
      selection.layer.transformComponents(selection, "Move components", () => {
        throw new Error("invalid transform");
      }),
    ).toThrow("invalid transform");

    const nextEdit = selection.layer.beginComponentTransformEdit(selection);
    nextEdit.discard();
  });

  /** The reference component and its counterpart in the Bold layer, as editing both sources selects them. */
  function matchedSelection(): ComponentTransformSelection {
    return {
      ...placedComponent(referenceLayer, referenceComponentId),
      additionalLayers: [placedComponent(targetLayer, targetComponentId)],
    };
  }

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

/** One layer's component and the glyph-local bounds it covers: the base square at its offset. */
describe("component transforms across editing sources", () => {
  let editor: EditorTestSurface;
  afterEach(() => editor.close());

  it("refuses a transform when any editing source lacks a complete component match", async () => {
    editor = await startEditorWith({
      glyphs: { base: { outline: { contours: [square(BASE_SIZE)] } }, root: {} },
      open: "root",
      axes: [WEIGHT],
      sources: { Bold: { wght: 700 } },
    });
    await editor.editSources(["Regular", "Bold"]);
    await editor.draw({ components: [{ glyph: "base" }] });
    await editor.editSources(["Bold"]);
    await editor.draw({ components: [{ glyph: "base" }] });
    await editor.editSources(["Regular", "Bold"]);
    expect((await editor.layerAt("Bold")).components).toHaveLength(2);

    const components = await editor.components();
    editor.selectObjects(components.map(({ id }) => id));
    expect(editor.rotateSelection(90)).toBe(false);
    expect((await editor.layerAt("Regular")).components).toEqual(components);
  });
});

function placedComponent(
  layer: GlyphLayer,
  componentId: ComponentId,
): ComponentTransformSelectionLayer {
  const { translateX, translateY } = componentTransform(layer, componentId);
  return {
    layer,
    componentIds: [componentId],
    bounds: Rect.fromXYWH(translateX, translateY, BASE_SIZE, BASE_SIZE),
  };
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
