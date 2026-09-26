import { describe, expect, it } from "vitest";
import { Point } from "@shift/glyph-state";
import type { GlyphName } from "@shift/types";
import { externalAxisLocationFromRecord } from "@shift/editor/variation";
import { TestEditor } from "@/testing/TestEditor";

describe("component references become removable or editable local contours", () => {
  it("adds, removes, restores, and recursively decomposes one component", async () => {
    const editor = new TestEditor();
    await editor.startSession("root", null);
    await editor.addGlyph("leaf", null);
    await editor.addGlyph("middle", null);

    const leafRecord = editor.font.recordForName("leaf" as GlyphName)!;
    const leaf = await editor.font.loadGlyph(leafRecord.id);
    const leafLayer = leaf.layerForSource(editor.font.defaultSource.id)!;
    const leafContourId = leafLayer.addContour();
    leafLayer.addPoint(leafContourId, Point.onCurve({ x: 40, y: 25 }));

    const middleRecord = editor.font.recordForName("middle" as GlyphName)!;
    const middle = await editor.font.loadGlyph(middleRecord.id);
    const middleLayer = middle.layerForSource(editor.font.defaultSource.id)!;
    middleLayer.addComponent(leafRecord.id);
    await editor.settle();

    const rootLayer = editor.requireGlyphLayer();
    const componentId = rootLayer.addComponent(middleRecord.id);
    await editor.settle();
    expect(rootLayer.components.map((component) => component.id)).toEqual([componentId]);
    expect(editor.sceneGlyphRenderModel?.contours).toHaveLength(1);

    rootLayer.removeComponents([componentId]);
    await editor.settle();
    expect(rootLayer.components).toEqual([]);
    expect(editor.sceneGlyphRenderModel?.contours).toHaveLength(0);

    await editor.undo();
    expect(rootLayer.components.map((component) => component.id)).toEqual([componentId]);
    expect(editor.sceneGlyphRenderModel?.contours).toHaveLength(1);

    rootLayer.decomposeComponents([componentId]);
    await editor.settle();
    expect(rootLayer.components).toEqual([]);
    expect(rootLayer.allPoints.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 40, y: 25 }]);

    await editor.undo();
    expect(rootLayer.components.map((component) => component.id)).toEqual([componentId]);
    expect(rootLayer.allPoints).toEqual([]);
    expect(editor.sceneGlyphRenderModel?.contours).toHaveLength(1);
  });

  it("creates a missing glyph and component as one undoable edit", async () => {
    const editor = new TestEditor();
    await editor.startSession("root", null);

    const componentId = await editor.createGlyphAndAddComponent("aacute" as GlyphName);
    const created = editor.font.recordForName("aacute" as GlyphName);
    expect(componentId).not.toBeNull();
    expect(created?.unicodes).toEqual([0x00e1]);
    expect(editor.requireGlyphLayer().components[0]?.baseGlyphId).toBe(created?.id);

    await editor.undo();
    expect(editor.font.recordForName("aacute" as GlyphName)).toBeNull();
    expect(editor.requireGlyphLayer().components).toEqual([]);

    await editor.redo();
    expect(editor.font.recordForName("aacute" as GlyphName)?.id).toBe(created?.id);
    expect(editor.requireGlyphLayer().components[0]?.baseGlyphId).toBe(created?.id);
  });

  it("deletes a selected component without requiring visible bounds", async () => {
    const editor = new TestEditor();
    await editor.startSession("root", null);
    await editor.addGlyph("empty-base", null);

    const baseRecord = editor.font.recordForName("empty-base" as GlyphName)!;
    const componentId = await editor.addComponent(baseRecord.id);
    if (!componentId) throw new Error("Expected added component");
    expect(editor.componentTransformSelection([componentId])).toBeNull();

    await expect(editor.deleteSelection()).resolves.toBe(true);
    expect(editor.requireGlyphLayer().components).toEqual([]);
  });

  it("adds and deletes matching components across selected sources as one edit", async () => {
    const editor = new TestEditor();
    await editor.startSession("root", null);
    await editor.addGlyph("base", null);

    const baseRecord = editor.font.recordForName("base" as GlyphName)!;
    const base = await editor.font.loadGlyph(baseRecord.id);
    const baseLayer = base.layerForSource(editor.font.defaultSource.id)!;
    const contourId = baseLayer.addContour();
    baseLayer.addPoint(contourId, Point.onCurve({ x: 0, y: 0 }));
    baseLayer.addPoint(contourId, Point.onCurve({ x: 100, y: 100 }));
    await editor.settle();

    const referenceSourceId = editor.font.defaultSource.id;
    const axisId = editor.font.createAxis({
      tag: "wght",
      name: "Weight",
      role: "external",
      axisType: "continuous",
      minimum: 100,
      default: 400,
      maximum: 900,
      labels: [],
      hidden: false,
    });
    await editor.settle();
    const targetSourceId = editor.createSource(
      "Bold",
      externalAxisLocationFromRecord({ [axisId]: 700 }),
    );
    await editor.settle();

    editor.selectSourceForEditing(referenceSourceId);
    editor.selectSourceForEditing(targetSourceId, "toggle");

    const componentId = await editor.addComponent(baseRecord.id);
    expect(componentId).not.toBeNull();
    expect(editor.selection.ids).toEqual([componentId]);

    const root = editor.glyphForId(editor.glyphNode!.glyphId)!;
    const referenceLayer = root.layerForSource(referenceSourceId)!;
    const targetLayer = root.layerForSource(targetSourceId)!;
    expect(referenceLayer.components).toHaveLength(1);
    expect(targetLayer.components).toHaveLength(1);
    await expect.poll(() => editor.editingLayerMatchesCell.peek().size).toBe(1);

    await expect(editor.deleteSelection()).resolves.toBe(true);
    expect(referenceLayer.components).toEqual([]);
    expect(targetLayer.components).toEqual([]);

    await editor.undo();
    expect(referenceLayer.components).toHaveLength(1);
    expect(targetLayer.components).toHaveLength(1);

    await editor.redo();
    expect(referenceLayer.components).toEqual([]);
    expect(targetLayer.components).toEqual([]);
  });
});
