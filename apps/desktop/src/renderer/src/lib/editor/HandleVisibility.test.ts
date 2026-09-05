import { beforeEach, describe, expect, it } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import { HandleItems } from "./rendering/overlays/handles/HandleItems";

describe("handle visibility is independent of geometry and selection", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("shape");
    editor.toolRegistry
      .get("shape")!
      .menuItems!.find((item) => item.id === "ellipse")!
      .onSelect();
    await editor.dragScene({
      down: { x: 0, y: 0 },
      start: { x: 40, y: 30 },
      end: { x: 200, y: 100 },
    });
  });

  it("hides one Bézier handle without hiding its siblings or changing selection bounds", () => {
    const contour = editor.glyphContours[0];
    const bounds = editor.selectionBoundsCell.peek();
    const showHandles = editor.hideHandles(contour.points[1].id);
    expect(editor.handlesVisible(contour.points[1].id)).toBe(false);
    expect(editor.handlesVisible(contour.points[0].id)).toBe(true);
    expect(editor.handlesVisible(contour.id)).toBe(true);
    expect(editor.glyphContours[0].points).toEqual(contour.points);
    expect(editor.selection.ids).toEqual([contour.id]);
    expect(editor.selectionBoundsCell.peek()).toEqual(bounds);
    showHandles();
    expect(editor.handlesVisible(contour.points[1].id)).toBe(true);
  });

  it("keeps overlapping point and contour requests independent and idempotent", () => {
    const contour = editor.glyphContours[0];
    const pointId = contour.points[1].id;
    const showPoint = editor.hideHandles(pointId);
    const showContour = editor.hideHandles(contour.id);
    showPoint();
    showPoint();
    expect(editor.handlesVisible(pointId)).toBe(false);
    expect(editor.handlesVisible(contour.points[2].id)).toBe(false);
    showContour();
    expect(editor.handlesVisible(pointId)).toBe(true);
    expect(editor.handlesVisible(contour.points[2].id)).toBe(true);
  });

  it("retains a point request when a contour request is released first", () => {
    const contour = editor.glyphContours[0];
    const pointId = contour.points[1].id;
    const showPoint = editor.hideHandles(pointId);
    const showContour = editor.hideHandles(contour.id);
    showContour();
    expect(editor.handlesVisible(pointId)).toBe(false);
    expect(editor.handlesVisible(contour.points[2].id)).toBe(true);
    showPoint();
    expect(editor.handlesVisible(pointId)).toBe(true);
  });

  it("does not release another request for the same point", () => {
    const pointId = editor.glyphContours[0].points[1].id;
    const showFirst = editor.hideHandles(pointId);
    const showSecond = editor.hideHandles(pointId);
    showFirst();
    showFirst();
    expect(editor.handlesVisible(pointId)).toBe(false);
    showSecond();
    expect(editor.handlesVisible(pointId)).toBe(true);
  });

  it("omits only the hidden marker while preserving its neighbors' geometric context", () => {
    const contour = editor.glyphContours[0];
    editor.hideHandles(contour.points[1].id);
    const list = new HandleItems().fromContours(
      [contour],
      { selection: editor.selection, hover: editor.hover },
      (pointId, contourId) => editor.handlesVisible(pointId, contourId),
    );
    expect(list.items).toHaveLength(11);
    expect(list.items.map((item) => item.point.id)).not.toContain(contour.points[1].id);
    expect(list.items[0].next?.id).toBe(contour.points[1].id);
    expect(contour.points).toHaveLength(12);
  });
});
