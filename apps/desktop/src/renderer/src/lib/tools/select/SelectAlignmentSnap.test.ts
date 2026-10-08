import { beforeEach, describe, expect, it } from "vitest";
import type { Rect2D } from "@shift/geo";
import type { PointId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

describe("Select aligns dragged points with points that stay put", () => {
  let editor: TestEditor;
  let leftId: PointId;
  let middleId: PointId;
  let rightId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    [leftId, middleId, rightId] = (await editor.drawOpenContour([
      { x: 100, y: 120 },
      { x: 240, y: 260 },
      { x: 380, y: 160 },
    ])) as [PointId, PointId, PointId];
    editor.selectTool("select");
  });

  it("lines a point up vertically with another point's x", async () => {
    const nearX = 100 + editor.hitRadius / 2;

    await editor.dragLocal({
      down: { x: 240, y: 260 },
      start: { x: nearX, y: 300 },
      end: { x: nearX, y: 300 },
    });

    expect(editor.pointPosition(middleId)).toEqual({ x: 100, y: 300 });
  });

  it("aligns each axis with a different point in one drag", async () => {
    const near = editor.hitRadius / 2;

    await editor.dragLocal({
      down: { x: 240, y: 260 },
      start: { x: 380 - near, y: 120 + near },
      end: { x: 380 - near, y: 120 + near },
    });

    expect(editor.pointPosition(middleId)).toEqual({ x: 380, y: 120 });
    expect(editor.pointPosition(leftId)).toEqual({ x: 100, y: 120 });
    expect(editor.pointPosition(rightId)).toEqual({ x: 380, y: 160 });
  });

  it("does not align beyond the hit radius", async () => {
    const farX = 100 + editor.hitRadius * 2;

    await editor.dragLocal({
      down: { x: 240, y: 260 },
      start: { x: farX, y: 300 },
      end: { x: farX, y: 300 },
    });

    expect(editor.pointPosition(middleId)).toEqual({ x: farX, y: 300 });
  });
});

describe("Select only aligns with points on screen", () => {
  let editor: TestEditor;
  let leftId: PointId;
  let middleId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.setCameraRect({ width: 1000, height: 800 } as Rect2D);
    [leftId, middleId] = (await editor.drawOpenContour([
      { x: 100, y: 120 },
      { x: 240, y: 260 },
      { x: 180, y: 6000 },
    ])) as [PointId, PointId, PointId];
    editor.selectTool("select");
    editor.selection.select([leftId, middleId]);
    editor.zoomToSelection();
    editor.selection.clear();
  });

  it("ignores a point scrolled out of view", async () => {
    const nearOffscreenX = 180 + editor.hitRadius / 2;

    await editor.dragLocal({
      down: { x: 240, y: 260 },
      start: { x: nearOffscreenX, y: 200 },
      end: { x: nearOffscreenX, y: 200 },
    });

    const moved = editor.pointPosition(middleId);
    expect(moved.x).toBeCloseTo(nearOffscreenX);
    expect(moved.y).toBeCloseTo(200);
  });

  it("still aligns with a point in view", async () => {
    const nearLeftX = 100 + editor.hitRadius / 2;

    await editor.dragLocal({
      down: { x: 240, y: 260 },
      start: { x: nearLeftX, y: 200 },
      end: { x: nearLeftX, y: 200 },
    });

    const moved = editor.pointPosition(middleId);
    expect(moved.x).toBe(100);
    expect(moved.y).toBeCloseTo(200);
  });
});

describe("Select does not align a dragged group with its own edges", () => {
  it("lets a rectangle's top edge shift sideways off its bottom corners", async () => {
    const editor = new TestEditor();
    await editor.startSession();
    const [, topLeftId, topRightId] = (await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 100, y: 300 },
      { x: 300, y: 300 },
      { x: 300, y: 100 },
    ])) as [PointId, PointId, PointId, PointId];
    const layer = editor.requireGlyphLayer();
    layer.closeContour(layer.contours[0]!.id);
    await editor.settle();
    editor.selectTool("select");
    const shift = editor.hitRadius / 2;

    await editor.dragLocal({
      down: { x: 200, y: 300 },
      start: { x: 200 + shift, y: 260 },
      end: { x: 200 + shift, y: 260 },
    });

    expect(editor.pointPosition(topLeftId)).toEqual({ x: 100 + shift, y: 260 });
    expect(editor.pointPosition(topRightId)).toEqual({ x: 300 + shift, y: 260 });
  });
});
