import { beforeEach, describe, expect, it } from "vitest";
import type { Point2D } from "@shift/geo";
import type { PointId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

function expectClose(actual: Point2D, expected: Point2D): void {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
}

describe("Option slides a smooth junction along its handles", () => {
  let editor: TestEditor;
  let junctionId: PointId;
  let incomingId: PointId;
  let outgoingId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("pen");
    await editor.clickLocal(100, 100);
    await editor.dragLocal({
      down: { x: 400, y: 100 },
      start: { x: 410, y: 110 },
      end: { x: 500, y: 200 },
    });
    await editor.dragLocal({
      down: { x: 700, y: 100 },
      start: { x: 710, y: 100 },
      end: { x: 800, y: 100 },
    });
    editor.selectTool("select");

    const [first, second] = editor.requireGlyphLayer().contours[0]!.segments();
    junctionId = first!.asCubic()!.end.id;
    incomingId = first!.asCubic()!.controlEnd.id;
    outgoingId = second!.asCubic()!.controlStart.id;
  });

  it("drags the on-curve point along the handle line and leaves both handles in place", async () => {
    await editor.dragLocal({
      down: { x: 400, y: 100 },
      start: { x: 420, y: 100 },
      end: { x: 450, y: 100 },
      options: { altKey: true },
    });

    expectClose(editor.pointPosition(junctionId), { x: 425, y: 125 });
    expectClose(editor.pointPosition(incomingId), { x: 300, y: 0 });
    expectClose(editor.pointPosition(outgoingId), { x: 500, y: 200 });
  });

  it("moves the whole junction freely without Option", async () => {
    await editor.dragLocal({
      down: { x: 400, y: 100 },
      start: { x: 420, y: 100 },
      end: { x: 450, y: 100 },
    });

    expectClose(editor.pointPosition(junctionId), { x: 450, y: 100 });
    expectClose(editor.pointPosition(outgoingId), { x: 550, y: 200 });
  });

  it("drags a handle along its own direction, changing only its length", async () => {
    await editor.dragLocal({
      down: { x: 500, y: 200 },
      start: { x: 520, y: 200 },
      end: { x: 550, y: 200 },
      options: { altKey: true },
    });

    expectClose(editor.pointPosition(outgoingId), { x: 525, y: 225 });
    expectClose(editor.pointPosition(junctionId), { x: 400, y: 100 });
  });

  it("nudges a handle along its own direction", async () => {
    editor.selection.select([outgoingId]);

    await editor.pressKey("ArrowRight", { altKey: true, shiftKey: true });

    expectClose(editor.pointPosition(outgoingId), { x: 505, y: 205 });
    expectClose(editor.pointPosition(junctionId), { x: 400, y: 100 });
  });

  it("nudges the on-curve point along the handle line without moving the handles", async () => {
    editor.selection.select([junctionId]);

    await editor.pressKey("ArrowUp", { altKey: true, shiftKey: true });

    expectClose(editor.pointPosition(junctionId), { x: 405, y: 105 });
    expectClose(editor.pointPosition(incomingId), { x: 300, y: 0 });
    expectClose(editor.pointPosition(outgoingId), { x: 500, y: 200 });
  });

  it("undoes a slide as one edit", async () => {
    await editor.dragLocal({
      down: { x: 400, y: 100 },
      start: { x: 420, y: 100 },
      end: { x: 450, y: 100 },
      options: { altKey: true },
    });

    await editor.undo();

    expectClose(editor.pointPosition(junctionId), { x: 400, y: 100 });
  });
});

describe("Option on a corner point between lines", () => {
  it("moves the point freely because no handle defines a slide direction", async () => {
    const editor = new TestEditor();
    await editor.startSession();
    const [, cornerId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 500, y: 300 },
    ]);
    editor.selectTool("select");

    await editor.dragLocal({
      down: { x: 300, y: 100 },
      start: { x: 320, y: 100 },
      end: { x: 350, y: 140 },
      options: { altKey: true },
    });

    expectClose(editor.pointPosition(cornerId!), { x: 350, y: 140 });
    expect(editor.requireGlyphLayer().contours).toHaveLength(1);
  });
});
