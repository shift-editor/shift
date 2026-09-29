import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import type { GlyphLayer } from "@shift/editor/model";
import { TestEditor } from "@/testing/TestEditor";

describe("Select edit ghost", () => {
  let editor: TestEditor;
  let layer: GlyphLayer;
  let pointId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    [, pointId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 300, y: 100 },
    ]);
    layer = editor.requireGlyphLayer();
    editor.selectTool("select");
  });

  function startPointDrag(): void {
    const down = editor.projectSceneToScreen({ x: 200, y: 100 });
    const threshold = editor.projectSceneToScreen({ x: 210, y: 120 });
    const next = editor.projectSceneToScreen({ x: 240, y: 160 });

    editor.pointerDown(down.x, down.y);
    editor.pointerMove(threshold.x, threshold.y);
    editor.pointerMove(next.x, next.y);
  }

  it("keeps the pre-drag outline while a point is dragged", () => {
    startPointDrag();

    expect(editor.pointPosition(pointId)).not.toEqual({ x: 200, y: 100 });
    expect(layer.editBaseGeometryCell.peek()?.point(pointId)).toMatchObject({ x: 200, y: 100 });
    expect(layer.editBaseOutlineCell.peek()).not.toBeNull();
  });

  it("clears the ghost when the drag commits", async () => {
    startPointDrag();
    const up = editor.projectSceneToScreen({ x: 240, y: 160 });
    editor.pointerUp(up.x, up.y);
    await editor.settle();

    expect(editor.pointPosition(pointId)).not.toEqual({ x: 200, y: 100 });
    expect(layer.editBaseGeometryCell.peek()).toBeNull();
    expect(layer.editBaseOutlineCell.peek()).toBeNull();
  });

  it("clears the ghost when the drag is canceled", () => {
    startPointDrag();
    editor.escape();

    expect(editor.pointPosition(pointId)).toEqual({ x: 200, y: 100 });
    expect(layer.editBaseGeometryCell.peek()).toBeNull();
  });
});
