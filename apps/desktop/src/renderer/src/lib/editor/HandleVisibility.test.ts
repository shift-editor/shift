import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import type { OutlineContour } from "@/testing/reads";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

describe("handle visibility is independent of geometry and selection", () => {
  let editor: EditorTestSurface;
  let first: OutlineContour;

  /** The ids of the point handles the canvas draws. */
  const drawnHandleIds = (): readonly PointId[] =>
    editor.drawnHandles().map(({ pointId }) => pointId);

  beforeEach(async () => {
    editor = await startTestEditor();
    editor.chooseToolMenuItem("shape", "ellipse");
    await editor.dragFrom({ x: 0, y: 0 }, { x: 200, y: 100 });
    const [contour] = await editor.outline();
    if (!contour) throw new Error("Expected the first ellipse's contour");
    first = contour;
  });

  it("hides the handles of the shape being dragged out, not its siblings', without changing its geometry or selection bounds", async () => {
    const firstIds = first.points.map(({ id }) => id);

    editor.chooseToolMenuItem("shape", "ellipse");
    editor.holdDragFrom({ x: 300, y: 0 }, { x: 500, y: 100 });
    const dragged = editor.drawnOutline()[1];
    if (!dragged) throw new Error("Expected the ellipse being dragged out");
    const draggedIds = dragged.points.map(({ id }) => id);

    expect(drawnHandleIds()).toEqual(firstIds);
    expect(drawnHandleIds()).not.toContain(draggedIds[1]);
    expect(dragged.points).toHaveLength(first.points.length);
    expect(editor.selectionIds()).toEqual([dragged.id]);
    expect(editor.selectionLocalRect()).toMatchObject({ x: 300, y: 0, width: 200, height: 100 });

    await editor.releaseAt({ x: 500, y: 100 });
    expect((await editor.outline())[1]?.points.map(({ id }) => id)).toEqual(draggedIds);
    expect(drawnHandleIds()).toEqual([...firstIds, ...draggedIds]);
  });
});
