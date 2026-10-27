import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Point2D } from "@shift/geo";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

let editor: EditorTestSurface;
beforeEach(async () => {
  editor = await startTestEditor();
  await editor.draw({
    advance: 500,
    contours: [
      {
        closed: true,
        points: [
          [100, 200],
          [150, 200],
          [150, 250],
          [100, 250],
        ],
      },
    ],
  });
});
afterEach(() => editor.close());

async function spacing(e: EditorTestSurface) {
  const bounds = await e.outlineBounds();
  const advance = await e.advanceWidth();
  return { advance, left: bounds!.min.x, right: advance - bounds!.max.x };
}

async function positions(e: EditorTestSurface): Promise<Point2D[]> {
  return (await e.outline()).flatMap(({ points }) => points.map(({ x, y }) => ({ x, y })));
}

describe("setting the glyph's metrics from the sidebar", () => {
  it("sets the advance width as one undoable step", async () => {
    editor.setAdvanceWidth(540);
    await editor.settle();
    expect(await editor.advanceWidth()).toBe(540);

    await editor.undo();
    expect(await editor.advanceWidth()).toBe(500);
    await editor.redo();
    expect(await editor.advanceWidth()).toBe(540);
  });

  it("sets the right sidebearing without moving the outline", async () => {
    const outline = await positions(editor);

    editor.setRightSidebearing(380);
    await editor.settle();

    expect(await spacing(editor)).toEqual({ advance: 530, left: 100, right: 380 });
    expect(await positions(editor)).toEqual(outline);
  });

  it("undoes and redoes the right sidebearing as one advance change", async () => {
    editor.setRightSidebearing(380);
    await editor.settle();

    await editor.undo();
    expect(await spacing(editor)).toEqual({ advance: 500, left: 100, right: 350 });
    await editor.redo();
    expect(await spacing(editor)).toEqual({ advance: 530, left: 100, right: 380 });
  });

  it("sets the left sidebearing by moving the outline and keeping the right sidebearing", async () => {
    const outline = await positions(editor);

    editor.setLeftSidebearing(125);
    await editor.settle();

    expect(await spacing(editor)).toEqual({ advance: 525, left: 125, right: 350 });
    expect(await positions(editor)).toEqual(outline.map(({ x, y }) => ({ x: x + 25, y })));
  });

  it("undoes and redoes the left sidebearing as one outline and advance change", async () => {
    const outline = await positions(editor);
    editor.setLeftSidebearing(125);
    await editor.settle();

    await editor.undo();
    expect(await spacing(editor)).toEqual({ advance: 500, left: 100, right: 350 });
    expect(await positions(editor)).toEqual(outline);
    await editor.redo();
    expect(await spacing(editor)).toEqual({ advance: 525, left: 125, right: 350 });
  });
});
