import { describe, expect, it } from "vitest";
import { Point } from "@shift/glyph-state";
import type { GlyphName } from "@shift/types";
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
});
