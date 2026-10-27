import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

let editor: EditorTestSurface;
let middle: PointId;

beforeEach(async () => {
  editor = await startTestEditor();
  ({ middle } = await editor.draw({
    contours: [{ points: [[100, 100], { x: 200, y: 100, name: "middle" }, [300, 100]] }],
  }));
  editor.selectTool("select");
});
afterEach(() => editor.close());

describe("dragging shows the outline as it was before the drag", () => {
  it("keeps the pre-drag outline while a point is dragged", () => {
    editor.holdDrag(middle, { x: 40, y: 60 });

    expect(editor.shownPointPositions([middle])).toEqual({ [middle]: { x: 240, y: 160 } });
    expect(editor.editGhost([middle])).toEqual({ [middle]: { x: 200, y: 100 } });
  });

  it("clears the ghost when the drag is released", async () => {
    editor.holdDrag(middle, { x: 40, y: 60 });
    await editor.releaseAt({ x: 240, y: 160 });

    expect(await editor.pointPositions([middle])).toEqual({ [middle]: { x: 240, y: 160 } });
    expect(editor.editGhost([middle])).toBeNull();
  });

  it("clears the ghost when Escape cancels the drag", async () => {
    editor.holdDrag(middle, { x: 40, y: 60 });
    await editor.pressKey("Escape");

    expect(editor.shownPointPositions([middle])).toEqual({ [middle]: { x: 200, y: 100 } });
    expect(editor.editGhost([middle])).toBeNull();
  });
});
