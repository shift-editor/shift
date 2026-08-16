import { beforeEach, describe, expect, it } from "vitest";
import { mintNodeId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";
import { effect } from "@/lib/signals";
import { runRendererCommand } from "@/lib/commands/rendererCommands";
import { externalAxisLocationFromRecord } from "@/lib/variation/location";

describe("Editor scene bootstrap", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
  });

  it("places the opened glyph as one glyph node at the origin", () => {
    const record = editor.font.recordForName("A")!;
    const nodes = editor.scene.nodes();

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      kind: "glyph",
      glyphId: record.id,
      sourceId: editor.font.defaultSource.id,
      position: { x: 0, y: 0 },
    });
  });

  it("can place the same glyph id twice with distinct node ids", () => {
    const record = editor.font.recordForName("A")!;
    const left = mintNodeId();
    const right = mintNodeId();

    editor.scene.setNodes([
      {
        id: left,
        type: "node",
        kind: "glyph",
        parentId: null,
        index: "a0",
        glyphId: record.id,
        sourceId: editor.font.defaultSource.id,
        position: { x: 0, y: 0 },
      },
      {
        id: right,
        type: "node",
        kind: "glyph",
        parentId: null,
        index: "a1",
        glyphId: record.id,
        sourceId: editor.font.defaultSource.id,
        position: { x: 700, y: 0 },
      },
    ]);

    const leftNode = editor.scene.node(left);
    const rightNode = editor.scene.node(right);
    if (leftNode?.kind !== "glyph" || rightNode?.kind !== "glyph") {
      throw new Error("Expected two glyph nodes");
    }

    expect(leftNode.glyphId).toBe(record.id);
    expect(rightNode.glyphId).toBe(record.id);
    expect(editor.getPointInNodeSpace({ x: 710, y: 20 }, { x: 700, y: 0 })).toEqual({
      x: 10,
      y: 20,
    });

    editor.scene.updateNode({
      id: rightNode.id,
      position: { x: rightNode.position.x + 30, y: rightNode.position.y + 5 },
    });

    expect(editor.scene.node(right)?.position).toEqual({ x: 730, y: 5 });
  });

  it("resolves authored points through the ownership index and keeps their bounds live", async () => {
    editor.selectTool("pen");
    editor.clickGlyphLocal(0, 0);
    await editor.settle();
    editor.clickGlyphLocal(100, 0);
    await editor.settle();
    editor.clickGlyphLocal(100, 100);
    await editor.settle();

    const layer = editor.requireGlyphLayer();
    const point = layer.allPoints[0];
    if (!point) throw new Error("Expected an authored point");

    const object = editor.object(point.id);
    if (object?.kind !== "point") throw new Error("Expected a point object");

    expect(object.layer).toBe(layer);

    let x = object.bounds()?.x ?? Number.NaN;
    const subscription = effect(() => {
      x = object.bounds()?.x ?? Number.NaN;
    });

    layer.movePoints([point.id], { x: 25, y: 0 });

    expect(x).toBe(point.x + 25);
    expect(object.geometry.point(point.id)?.x).toBe(point.x + 25);
    subscription.dispose();
  });

  it("creates and selects a source by materializing the opened glyph", async () => {
    editor.selectTool("pen");
    editor.clickGlyphLocal(0, 0);
    await editor.settle();
    editor.clickGlyphLocal(100, 0);
    await editor.settle();
    editor.clickGlyphLocal(100, 100);
    await editor.settle();

    const node = editor.glyphNode;
    if (!node) throw new Error("Expected opened glyph node");

    const defaultLayer = editor
      .glyphForId(node.glyphId)
      ?.layerForSource(editor.font.defaultSource.id);
    if (!defaultLayer) throw new Error("Expected default glyph layer");

    const defaultContour = defaultLayer.contours[0];
    if (!defaultContour) throw new Error("Expected default contour");

    const axisId = editor.font.createAxis(weightAxis());
    await editor.settle();
    const sourceId = editor.createSource("Bold", externalAxisLocationFromRecord({ [axisId]: 700 }));

    expect(editor.activeSourceId).toBeNull();
    expect(editor.activeSource).toBeNull();

    await editor.settle();

    expect(editor.activeSourceId).toBe(sourceId);
    expect(editor.glyphNode?.sourceId).toBe(sourceId);

    const createdLayer = editor.glyphForId(node.glyphId)?.layerForSource(sourceId);
    if (!createdLayer) throw new Error("Expected seeded glyph layer");

    const createdContour = createdLayer.contours[0];
    if (!createdContour) throw new Error("Expected seeded contour");

    expect(createdLayer.xAdvance).toBe(defaultLayer.xAdvance);
    expect(createdContour.closed).toBe(defaultContour.closed);
    expect(
      createdContour.points.map(({ x, y, pointType, smooth }) => ({
        x,
        y,
        pointType,
        smooth,
      })),
    ).toEqual(
      defaultContour.points.map(({ x, y, pointType, smooth }) => ({
        x,
        y,
        pointType,
        smooth,
      })),
    );
    expect(createdContour.points.map((point) => point.id)).not.toEqual(
      defaultContour.points.map((point) => point.id),
    );
  });

  it("materializes the opened glyph when selecting a sparse source", async () => {
    editor.selectTool("pen");
    editor.clickGlyphLocal(0, 0);
    await editor.settle();
    editor.clickGlyphLocal(100, 0);
    await editor.settle();

    const node = editor.glyphNode;
    if (!node) throw new Error("Expected opened glyph node");

    const defaultLayer = editor
      .glyphForId(node.glyphId)
      ?.layerForSource(editor.font.defaultSource.id);
    if (!defaultLayer) throw new Error("Expected default glyph layer");

    const axisId = editor.font.createAxis(weightAxis());
    await editor.settle();
    const sourceId = editor.font.createSource(
      "Bold",
      externalAxisLocationFromRecord({ [axisId]: 700 }),
    );
    await editor.settle();

    expect(editor.glyphForId(node.glyphId)?.layerForSource(sourceId)).toBeNull();

    editor.selectSourceForEditing(sourceId);
    await editor.settle();

    const materializedLayer = editor.glyphForId(node.glyphId)?.layerForSource(sourceId);
    if (!materializedLayer) throw new Error("Expected materialized glyph layer");

    expect(editor.activeSourceId).toBe(sourceId);
    expect(materializedLayer.contours[0]?.points.map(({ x, y }) => ({ x, y }))).toEqual(
      defaultLayer.contours[0]?.points.map(({ x, y }) => ({ x, y })),
    );
    expect(materializedLayer.contours[0]?.points.map((point) => point.id)).not.toEqual(
      defaultLayer.contours[0]?.points.map((point) => point.id),
    );
  });
});

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

describe("Editor renderer commands", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    editor.click(0, 0);
    await editor.settle();
    editor.click(100, 0);
    await editor.settle();
    editor.click(200, 0);
    await editor.settle();
  });

  it("reverses the contour implied by selected points", async () => {
    const contour = editor.requireGlyphLayer().contours[0]!;
    editor.selection.select(contour.points.slice(0, 2).map((point) => point.id));

    const handled = runRendererCommand(editor, "glyph.reverseSelectedContour");
    await editor.settle();

    expect(handled).toBe(true);
    expect(editor.requireGlyphLayer().contours[0]!.points.map(({ x }) => x)).toEqual([200, 100, 0]);
  });
});
