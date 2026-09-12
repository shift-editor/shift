import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

describe("Select chooses on-curve snapping pivots from adjacent segments", () => {
  let editor: TestEditor;
  let firstId: PointId;
  let middleId: PointId;
  let lastId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    [firstId, middleId, lastId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
    ]);
    editor.selectTool("select");
  });

  it("snaps the first line endpoint around its next point", async () => {
    await editor.dragScene({
      down: { x: 100, y: 100 },
      start: { x: 220, y: 160 },
      end: { x: 220, y: 160 },
      options: { shiftKey: true },
    });
    expect(editor.pointPosition(firstId).x).toBeCloseTo(300 - 50 * Math.sqrt(3));
    expect(editor.pointPosition(firstId).y).toBeCloseTo(150);
    expect(editor.pointPosition(middleId)).toEqual({ x: 300, y: 100 });
  });

  it("snaps an open contour's final line endpoint around its previous point", async () => {
    await editor.dragScene({
      down: { x: 300, y: 300 },
      start: { x: 360, y: 180 },
      end: { x: 360, y: 180 },
      options: { shiftKey: true },
    });
    expect(editor.pointPosition(lastId).x).toBeCloseTo(350);
    expect(editor.pointPosition(lastId).y).toBeCloseTo(100 + 50 * Math.sqrt(3));
    expect(editor.pointPosition(middleId)).toEqual({ x: 300, y: 100 });
  });

  it("snaps a two-line junction around itself", async () => {
    await editor.dragScene({
      down: { x: 300, y: 100 },
      start: { x: 330, y: 140 },
      end: { x: 330, y: 140 },
      options: { shiftKey: true },
    });
    expect(editor.pointPosition(middleId).x).toBeCloseTo(325);
    expect(editor.pointPosition(middleId).y).toBeCloseTo(100 + 25 * Math.sqrt(3));
    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
    expect(editor.pointPosition(lastId)).toEqual({ x: 300, y: 300 });
  });

  it("recognizes both lines at a closed contour's first point", async () => {
    const layer = editor.requireGlyphLayer();
    layer.closeContour(layer.contours[0]!.id);
    await editor.settle();
    await editor.dragScene({
      down: { x: 100, y: 100 },
      start: { x: 130, y: 140 },
      end: { x: 130, y: 140 },
      options: { shiftKey: true },
    });
    expect(editor.pointPosition(firstId).x).toBeCloseTo(125);
    expect(editor.pointPosition(firstId).y).toBeCloseTo(100 + 25 * Math.sqrt(3));
  });

  it("uses the next line point when a cubic enters the dragged endpoint", async () => {
    const layer = editor.requireGlyphLayer();
    layer.upgradeLineToCubic(layer.contours[0]!.segments()[0]!.id);
    await editor.settle();
    await editor.dragScene({
      down: { x: 300, y: 100 },
      start: { x: 240, y: 220 },
      end: { x: 240, y: 220 },
      options: { shiftKey: true },
    });
    expect(editor.pointPosition(middleId).x).toBeCloseTo(250);
    expect(editor.pointPosition(middleId).y).toBeCloseTo(300 - 50 * Math.sqrt(3));
    expect(editor.pointPosition(lastId)).toEqual({ x: 300, y: 300 });
  });

  it("uses itself when an incoming line is followed by a cubic", async () => {
    const layer = editor.requireGlyphLayer();
    layer.upgradeLineToCubic(layer.contours[0]!.segments()[1]!.id);
    await editor.settle();
    await editor.dragScene({
      down: { x: 300, y: 100 },
      start: { x: 330, y: 140 },
      end: { x: 330, y: 140 },
      options: { shiftKey: true },
    });
    expect(editor.pointPosition(middleId).x).toBeCloseTo(325);
    expect(editor.pointPosition(middleId).y).toBeCloseTo(100 + 25 * Math.sqrt(3));
  });

  it("uses itself at the final endpoint of an open cubic", async () => {
    const layer = editor.requireGlyphLayer();
    layer.upgradeLineToCubic(layer.contours[0]!.segments()[1]!.id);
    await editor.settle();
    await editor.dragScene({
      down: { x: 300, y: 300 },
      start: { x: 330, y: 340 },
      end: { x: 330, y: 340 },
      options: { shiftKey: true },
    });
    expect(editor.pointPosition(lastId).x).toBeCloseTo(325);
    expect(editor.pointPosition(lastId).y).toBeCloseTo(300 + 25 * Math.sqrt(3));
  });

  it("leaves movement unconstrained without Shift", async () => {
    await editor.dragScene({
      down: { x: 100, y: 100 },
      start: { x: 220, y: 160 },
      end: { x: 220, y: 160 },
    });
    expect(editor.pointPosition(firstId)).toEqual({ x: 220, y: 160 });
  });

  it("does not apply single-point rules to a multi-point selection", async () => {
    editor.selection.select([firstId, lastId]);
    await editor.dragScene({
      down: { x: 200, y: 200 },
      start: { x: 230, y: 240 },
      end: { x: 230, y: 240 },
      options: { shiftKey: true },
    });
    expect(editor.pointPosition(firstId)).toEqual({ x: 130, y: 140 });
    expect(editor.pointPosition(lastId)).toEqual({ x: 330, y: 340 });
  });

  it.each([
    {
      down: { x: 100, y: 100 },
      end: { x: 130, y: 140 },
      first: { x: 130, y: 130 },
      last: { x: 300, y: 300 },
    },
    {
      down: { x: 300, y: 300 },
      end: { x: 330, y: 340 },
      first: { x: 100, y: 100 },
      last: { x: 340, y: 340 },
    },
    {
      down: { x: 100, y: 300 },
      end: { x: 70, y: 340 },
      first: { x: 60, y: 100 },
      last: { x: 300, y: 340 },
    },
    {
      down: { x: 300, y: 100 },
      end: { x: 330, y: 60 },
      first: { x: 100, y: 60 },
      last: { x: 340, y: 300 },
    },
  ])(
    "resizes at selection corner $down instead of snapping a point",
    async ({ down, end, first, last }) => {
      editor.selection.select([firstId, lastId]);
      const start = editor.projectSceneToScreen(down);
      const finish = editor.projectSceneToScreen(end);
      editor.pointerDown(start.x, start.y).pointerMove(finish.x, finish.y, { shiftKey: true });
      expect(editor.toolIf("select")?.state.type).toBe("resizing");
      editor.pointerUp(finish.x, finish.y);
      await editor.settle();
      expect(editor.pointPosition(firstId)).toEqual(first);
      expect(editor.pointPosition(lastId)).toEqual(last);
    },
  );

  it("commits a neighbor-pivot snap as one undoable and redoable movement", async () => {
    await editor.dragScene({
      down: { x: 100, y: 100 },
      start: { x: 220, y: 160 },
      end: { x: 220, y: 160 },
      options: { shiftKey: true },
    });
    const position = editor.pointPosition(firstId);
    expect(position.y).toBeCloseTo(150);
    await editor.undo();
    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
    await editor.redo();
    expect(editor.pointPosition(firstId)).toEqual(position);
  });
});
