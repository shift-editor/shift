import { describe, expect, it, beforeEach } from "vitest";
import type { Rect2D } from "@shift/geo";
import { TestEditor } from "@/testing/TestEditor";
import { DrawRectangleCommand } from "./ShapeCommands";

function rect(x: number, y: number, width: number, height: number): Rect2D {
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height };
}

// Restored from the WS6 behavioral inventory (git show ef037c6e^).
describe("DrawRectangleCommand", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
  });

  const source = () => editor.activeGlyphSource!;

  it("adds a closed four-point contour", async () => {
    const contourId = editor.commands.run(new DrawRectangleCommand(rect(10, 20, 100, 50)));
    await editor.settle();

    const contour = source().contour(contourId);
    expect(contour?.closed).toBe(true);
    expect(contour?.points.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 70 },
      { x: 10, y: 70 },
    ]);
  });

  it("coalesces contour, points, and close into one undo step", async () => {
    editor.commands.run(new DrawRectangleCommand(rect(0, 0, 10, 10)));
    await editor.settle();
    expect(source().contours.length).toBe(1);

    await editor.undoAndSettle();
    expect(source().contours.length).toBe(0);
  });
});
