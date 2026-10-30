import { localPoint } from "@shift/editor/spaces";
import { beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import { effect } from "@shift/editor/signals";
import { externalAxisLocationFromRecord } from "@shift/editor/variation";

describe("Editor scene bootstrap", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
  });

  it("places the opened glyph as the page run's child at the origin", () => {
    const record = editor.font.recordForName("A")!;
    const [run, child] = editor.scene.nodes();
    if (run?.kind !== "textRun") throw new Error("Expected the page run first");
    const item = editor.text.run(run.runId)?.items[0];

    expect(editor.scene.nodes()).toHaveLength(2);
    expect(run.position).toEqual({ x: 0, y: 0 });
    expect(child).toMatchObject({
      kind: "glyph",
      parentId: run.id,
      itemId: item?.id,
      glyphId: record.id,
      sourceId: editor.font.defaultSource.id,
    });
    expect(editor.toScene(child!, localPoint(0, 0))).toEqual({ x: 0, y: 0 });
    expect(editor.editing.nodeIds).toEqual([child!.id]);
  });

  it("resolves authored points and contours to their layer and the node showing it", async () => {
    const [pointId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
    const contourId = editor.font.contourIdForPoint(pointId!);

    const point = editor.object(pointId!);
    const contour = editor.object(contourId!);

    expect(point).toMatchObject({
      kind: "point",
      layer: editor.glyphLayer,
      node: editor.glyphNode,
    });
    expect(contour).toMatchObject({
      kind: "contour",
      layer: editor.glyphLayer,
      node: editor.glyphNode,
    });
  });

  it("resolves authored points through the ownership index and keeps their bounds live", async () => {
    editor.selectTool("pen");
    await editor.clickLocal(0, 0);
    await editor.clickLocal(100, 0);
    await editor.clickLocal(100, 100);

    const layer = editor.requireGlyphLayer();
    const point = layer.allPoints[0];
    if (!point) throw new Error("Expected an authored point");

    const object = editor.object(point.id);
    if (object?.kind !== "point") throw new Error("Expected a point object");

    expect(object.layer).toBe(layer);

    let x = object.bounds()?.min.x ?? Number.NaN;
    const subscription = effect(() => {
      x = object.bounds()?.min.x ?? Number.NaN;
    });

    layer.movePoints([point.id], { x: 25, y: 0 });

    expect(x).toBe(point.x + 25);
    expect(object.geometry.point(point.id)?.x).toBe(point.x + 25);
    subscription.dispose();
  });

  it("materializes the opened glyph when selecting a sparse source", async () => {
    editor.selectTool("pen");
    await editor.clickLocal(0, 0);
    await editor.clickLocal(100, 0);

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
