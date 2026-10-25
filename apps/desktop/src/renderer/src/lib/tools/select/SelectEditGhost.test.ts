import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";

describe("Select edit ghost", () => {
  let editor: TestEditor;
  let pointId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    [, pointId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 300, y: 100 },
    ]);
    editor.selectTool("select");
  });

  function startPointDrag(): void {
    const down = editor.localToScreen({ x: 200, y: 100 });
    const threshold = editor.localToScreen({ x: 210, y: 120 });
    const next = editor.localToScreen({ x: 240, y: 160 });

    editor.pointerDown(down.x, down.y);
    editor.pointerMove(threshold.x, threshold.y);
    editor.pointerMove(next.x, next.y);
  }

  const preDragOutline = [
    [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 300, y: 100 },
    ],
  ];

  it("keeps the pre-drag outline while a point is dragged", () => {
    startPointDrag();

    expect(editor.pointPosition(pointId)).not.toEqual({ x: 200, y: 100 });
    expect(editor.editGhostContours).toEqual(preDragOutline);
  });

  it("clears the ghost when the drag commits", async () => {
    startPointDrag();
    const up = editor.localToScreen({ x: 240, y: 160 });
    editor.pointerUp(up.x, up.y);
    await editor.settle();

    expect(editor.pointPosition(pointId)).not.toEqual({ x: 200, y: 100 });
    expect(editor.editGhostContours).toBeNull();
  });

  it("clears the ghost when the drag is canceled", () => {
    startPointDrag();
    editor.escape();

    expect(editor.pointPosition(pointId)).toEqual({ x: 200, y: 100 });
    expect(editor.editGhostContours).toBeNull();
  });
});
