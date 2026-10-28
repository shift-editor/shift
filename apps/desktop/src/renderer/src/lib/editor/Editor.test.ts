import { localPoint, scenePoint } from "@shift/editor/spaces";
import { beforeEach, describe, expect, it } from "vitest";
import { mintNodeId } from "@shift/types";
import type { GlyphNode } from "@shift/editor/types";
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

  it("finds the nodes that depend on a run or a glyph, and follows their removal", () => {
    const [run, child] = editor.scene.nodes();
    if (run?.kind !== "textRun" || child?.kind !== "glyph")
      throw new Error("Expected run and glyph");
    const dependents: number[] = [];
    const reader = effect(() => {
      dependents.push(editor.scene.nodesReferencing(child.glyphId).length);
    });

    expect(editor.scene.nodesReferencing(run.runId)).toEqual([run]);
    expect(editor.scene.nodesReferencing(child.glyphId)).toEqual([child]);

    editor.scene.deleteNode(child.id);
    reader.dispose();

    expect(dependents).toEqual([1, 0]);
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

  it("keeps the scene value when only the selection changes, and updates it when a node moves", async () => {
    const [pointId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ]);
    const scene = editor.scene.cell.peek();

    editor.selection.select([pointId!]);
    expect(editor.scene.cell.peek()).toBe(scene);

    const [node] = editor.scene.nodes();
    editor.scene.updateNode({ id: node!.id, position: { x: 40, y: 0 } });
    expect(editor.scene.cell.peek()).not.toBe(scene);
    expect(editor.scene.nodes()[0]?.position).toEqual({ x: 40, y: 0 });
  });

  it("names the one glyph node only while the scene shows exactly one", () => {
    const [firstRun, firstChild] = editor.scene.nodes();

    expect(editor.scene.only("glyph")).toBe(firstChild);
    expect(editor.scene.first("textRun")).toBe(firstRun);

    const record = editor.font.recordForName("A")!;
    editor.scene.createNode<GlyphNode>({
      kind: "glyph",
      glyphId: record.id,
      sourceId: editor.font.defaultSource.id,
      position: { x: 700, y: 0 },
    });

    expect(editor.scene.nodesOfKind("glyph")).toHaveLength(2);
    expect(editor.scene.only("glyph")).toBeNull();
    expect(editor.scene.first("glyph")).toBe(firstChild);
  });

  it("follows the one glyph node reactively as glyph nodes come and go", () => {
    const [, firstChild] = editor.scene.nodes();
    const onlyGlyph = editor.scene.onlyCell("glyph");
    const seen: (string | null)[] = [];
    const reader = effect(() => {
      seen.push(onlyGlyph.value?.id ?? null);
    });

    const record = editor.font.recordForName("A")!;
    const second = editor.scene.createNode<GlyphNode>({
      kind: "glyph",
      glyphId: record.id,
      sourceId: editor.font.defaultSource.id,
      position: { x: 700, y: 0 },
    });
    expect(onlyGlyph.peek()).toBeNull();

    editor.scene.deleteNode(firstChild!.id);
    reader.dispose();

    expect(onlyGlyph.peek()).toBe(editor.scene.node(second.id));
    expect(seen.at(-1)).toBe(second.id);
    expect(seen).toContain(null);
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
    expect(editor.toLocal(rightNode, scenePoint(710, -20))).toEqual({
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

  it("lists only the axes users set directly as external axes", async () => {
    const externalAxes = editor.font.externalAxesCell;
    const weightId = editor.font.createAxis(weightAxis());
    editor.font.createAxis({ ...weightAxis(), tag: "opsz", name: "Optical", role: "internal" });
    await editor.settle();

    expect(editor.font.getAxes()).toHaveLength(2);
    expect(externalAxes.peek().map(({ id }) => id)).toEqual([weightId]);
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
