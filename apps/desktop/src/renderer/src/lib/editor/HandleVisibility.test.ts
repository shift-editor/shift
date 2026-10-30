import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import type { OutlineContour } from "@/testing/reads";
import type { EditorTestSurface } from "@/testing/surface";
import { startTestEditor } from "@/testing/TestEditor";

describe("handle visibility is independent of geometry and selection", () => {
  let editor: EditorTestSurface;

  /** The ids of the point handles the canvas draws. */
  const drawnHandleIds = (): readonly PointId[] =>
    editor.drawnHandles().map(({ pointId }) => pointId);

  async function ellipse(): Promise<OutlineContour> {
    const [contour] = await editor.outline();
    if (!contour) throw new Error("Expected the ellipse's contour");
    return contour;
  }

  beforeEach(async () => {
    editor = await startTestEditor();
    editor.chooseToolMenuItem("shape", "ellipse");
    await editor.dragFrom({ x: 0, y: 0 }, { x: 200, y: 100 });
  });

  it("hides one Bézier handle without hiding its siblings or changing selection bounds", async () => {
    const contour = await ellipse();
    const others = contour.points.filter((_, index) => index !== 1).map(({ id }) => id);
    const bounds = editor.selectionLocalRect();
    const hidden = editor.requestHiddenHandles(contour.points[1]!.id);
    expect(drawnHandleIds()).not.toContain(contour.points[1]!.id);
    expect(drawnHandleIds()).toContain(contour.points[0]!.id);
    expect(drawnHandleIds()).toEqual(others);
    expect((await ellipse()).points).toEqual(contour.points);
    expect(editor.selectionIds()).toEqual([contour.id]);
    expect(editor.selectionLocalRect()).toEqual(bounds);
    editor.releaseHiddenHandles(hidden);
    expect(drawnHandleIds()).toContain(contour.points[1]!.id);
  });

  it("keeps overlapping point and contour requests independent and idempotent", async () => {
    const contour = await ellipse();
    const pointId = contour.points[1]!.id;
    const pointRequest = editor.requestHiddenHandles(pointId);
    const contourRequest = editor.requestHiddenHandles(contour.id);
    editor.releaseHiddenHandles(pointRequest);
    editor.releaseHiddenHandles(pointRequest);
    expect(drawnHandleIds()).not.toContain(pointId);
    expect(drawnHandleIds()).not.toContain(contour.points[2]!.id);
    editor.releaseHiddenHandles(contourRequest);
    expect(drawnHandleIds()).toContain(pointId);
    expect(drawnHandleIds()).toContain(contour.points[2]!.id);
  });

  it("retains a point request when a contour request is released first", async () => {
    const contour = await ellipse();
    const pointId = contour.points[1]!.id;
    const pointRequest = editor.requestHiddenHandles(pointId);
    const contourRequest = editor.requestHiddenHandles(contour.id);
    editor.releaseHiddenHandles(contourRequest);
    expect(drawnHandleIds()).not.toContain(pointId);
    expect(drawnHandleIds()).toContain(contour.points[2]!.id);
    editor.releaseHiddenHandles(pointRequest);
    expect(drawnHandleIds()).toContain(pointId);
  });

  it("does not release another request for the same point", async () => {
    const pointId = (await ellipse()).points[1]!.id;
    const first = editor.requestHiddenHandles(pointId);
    const second = editor.requestHiddenHandles(pointId);
    editor.releaseHiddenHandles(first);
    editor.releaseHiddenHandles(first);
    expect(drawnHandleIds()).not.toContain(pointId);
    editor.releaseHiddenHandles(second);
    expect(drawnHandleIds()).toContain(pointId);
  });
});
