import { beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";

describe("Select dropping an open end onto another open end", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
  });

  it("closes the contour when its end lands on its own start", async () => {
    const [, , lastId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
    ]);
    editor.selectTool("select");

    await editor.dragLocal({
      down: editor.pointPosition(lastId!),
      start: { x: 280, y: 280 },
      end: { x: 101, y: 101 },
    });

    const contour = editor.glyphContours[0];
    expect(editor.glyphContours).toHaveLength(1);
    expect(contour?.closed).toBe(true);
    expect(contour?.points.map((point) => point.position)).toEqual([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
    ]);
  });

  it("keeps an on-curve start when a curve's first point is dropped on its end", async () => {
    editor.selectTool("pen");
    await editor.clickLocal(100, 100);
    await editor.dragLocal({
      down: { x: 300, y: 100 },
      start: { x: 340, y: 120 },
      end: { x: 380, y: 180 },
    });
    await editor.dragLocal({
      down: { x: 300, y: 300 },
      start: { x: 280, y: 340 },
      end: { x: 250, y: 380 },
    });
    const firstId = editor.glyphContours[0]!.firstPoint!.id;
    editor.selectTool("select");

    await editor.dragLocal({
      down: editor.pointPosition(firstId),
      start: { x: 130, y: 130 },
      end: { x: 299, y: 299 },
    });

    const contour = editor.glyphContours[0];
    expect(contour?.closed).toBe(true);
    expect(contour?.firstPoint?.isOnCurve).toBe(true);
    expect(contour?.firstPoint?.position).toEqual({ x: 300, y: 300 });
  });

  it("joins two contours when an end lands on another contour's end", async () => {
    await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
    ]);
    editor.escape();
    await editor.drawOpenContour([
      { x: 100, y: 300 },
      { x: 300, y: 300 },
    ]);
    const lastId = editor.glyphContours[1]?.lastPoint?.id;
    if (!lastId) throw new Error("Expected a second contour");
    editor.selectTool("select");

    await editor.dragLocal({
      down: editor.pointPosition(lastId),
      start: { x: 300, y: 280 },
      end: { x: 299, y: 101 },
    });

    const contours = editor.glyphContours;
    expect(contours).toHaveLength(1);
    expect(contours[0]?.closed).toBe(false);
    expect(contours[0]?.points.map((point) => point.position)).toEqual([
      { x: 100, y: 300 },
      { x: 300, y: 100 },
      { x: 100, y: 100 },
    ]);
  });

  it("undoes the move and the join in one step", async () => {
    const [, , lastId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
    ]);
    editor.selectTool("select");
    await editor.dragLocal({
      down: editor.pointPosition(lastId!),
      start: { x: 280, y: 280 },
      end: { x: 101, y: 101 },
    });

    await editor.undo();

    const contour = editor.glyphContours[0];
    expect(contour?.closed).toBe(false);
    expect(contour?.points.map((point) => point.position)).toEqual([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
    ]);
  });

  it("shows the end cursor while a dragged end is over another open end", async () => {
    const [, , lastId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
    ]);
    editor.selectTool("select");
    const down = editor.localToScreen(editor.pointPosition(lastId!));
    const away = editor.localToScreen({ x: 280, y: 280 });
    const over = editor.localToScreen({ x: 101, y: 101 });
    const cursor = () => editor.toolManager.activeTool?.cursorCell.value;

    editor.pointerDown(down.x, down.y).pointerMove(away.x, away.y);
    expect(cursor()).toEqual({ type: "move" });

    editor.pointerMove(over.x, over.y);
    expect(cursor()).toEqual({ type: "end" });
    editor.escape();
  });

  it("only moves an end dropped away from other ends", async () => {
    const [, , lastId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 300 },
    ]);
    editor.selectTool("select");

    await editor.dragLocal({
      down: editor.pointPosition(lastId!),
      start: { x: 300, y: 280 },
      end: { x: 300, y: 250 },
    });

    const contour = editor.glyphContours[0];
    expect(contour?.closed).toBe(false);
    expect(contour?.points).toHaveLength(3);
  });
});
