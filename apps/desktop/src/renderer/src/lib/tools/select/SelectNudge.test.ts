import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

describe("Select arrow keys nudge selected points", () => {
  let editor: TestEditor;
  let firstId: PointId;
  let secondId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    [firstId, secondId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ]);
    editor.selection.select([firstId]);
    editor.selectTool("select");
  });

  it.each([
    ["ArrowLeft", { x: 99, y: 100 }],
    ["ArrowRight", { x: 101, y: 100 }],
    ["ArrowUp", { x: 100, y: 101 }],
    ["ArrowDown", { x: 100, y: 99 }],
  ] as const)("moves in the %s direction", async (key, expected) => {
    await editor.pressKey(key);

    expect(editor.pointPosition(firstId)).toEqual(expected);
    expect(editor.pointPosition(secondId)).toEqual({ x: 200, y: 200 });
  });

  it.each([
    ["the default increment", {}, 1],
    ["the Shift increment", { shiftKey: true }, 10],
    ["the accelerator increment", { metaKey: true }, 100],
  ] as const)("uses %s", async (_description, modifiers, distance) => {
    await editor.pressKey("ArrowRight", modifiers);

    expect(editor.pointPosition(firstId)).toEqual({ x: 100 + distance, y: 100 });
  });

  it("moves every selected point by the same increment", async () => {
    editor.selection.select([firstId, secondId]);

    await editor.pressKey("ArrowUp", { shiftKey: true });

    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 110 });
    expect(editor.pointPosition(secondId)).toEqual({ x: 200, y: 210 });
  });

  it("commits a nudge as one undoable and redoable edit", async () => {
    editor.selection.select([firstId, secondId]);
    await editor.pressKey("ArrowRight", { shiftKey: true });
    const nudged = [editor.pointPosition(firstId), editor.pointPosition(secondId)];

    await editor.undo();
    expect([editor.pointPosition(firstId), editor.pointPosition(secondId)]).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ]);

    await editor.redo();
    expect([editor.pointPosition(firstId), editor.pointPosition(secondId)]).toEqual(nudged);
  });
});
