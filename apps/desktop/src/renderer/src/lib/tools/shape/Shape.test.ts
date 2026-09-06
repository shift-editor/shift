import { describe, it, expect, beforeEach } from "vitest";
import { TestEditor } from "@/testing/TestEditor";
import { Ellipse } from "./Ellipse";
import { Rectangle } from "./Rectangle";
import { Mat, Rect } from "@shift/geo";
import { ContourPath } from "@/lib/graphics/ContourPath";

// Restored from the WS6 behavioral inventory (git show ef037c6e^); asserts
// confirmed (folded) geometry rather than the deleted currentGlyph getter.
describe("Shape tool", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("shape");
  });

  const contours = () => editor.glyphLayer?.geometry.contours ?? [];

  it("publishes lifecycle state through the typed tool surface", () => {
    expect(editor.toolIf("shape")?.state).toEqual({ type: "ready" });

    editor.selectTool("select");

    expect(editor.toolIf("shape")).toBeNull();
    expect(editor.toolIf("select")?.state).toEqual({ type: "ready" });
  });

  it("drag then release commits a closed 4-point rectangle contour", async () => {
    const contoursBefore = contours().length;

    await editor.dragScene({
      down: { x: 10, y: 10 },
      start: { x: 50, y: 30 },
      end: { x: 110, y: 90 },
    });

    const all = contours();
    expect(all.length).toBe(contoursBefore + 1);

    const created = all[all.length - 1]!;
    expect(created.points.length).toBe(4);
    expect(created.closed).toBe(true);
  });

  it("selects the committed rectangle and returns to the Select tool", async () => {
    await editor.dragScene({
      down: { x: 10, y: 10 },
      start: { x: 50, y: 30 },
      end: { x: 110, y: 90 },
    });

    const created = contours().at(-1);
    expect(editor.selection.ids).toEqual([created?.id]);
    expect(editor.toolIf("select")?.state).toEqual({ type: "ready" });
  });

  it("creates an ellipse rather than a rectangle when Ellipse is selected", async () => {
    editor.toolRegistry
      .get("shape")!
      .menuItems!.find((item) => item.id === "ellipse")!
      .onSelect();
    await editor.dragScene({
      down: { x: 10, y: 20 },
      start: { x: 80, y: 60 },
      end: { x: 210, y: 120 },
    });

    const created = contours()[0];
    expect(created.points).toHaveLength(12);
    expect(created.points.filter((point) => point.smooth)).toHaveLength(4);
    expect(created.segments().map((segment) => segment.type)).toEqual([
      "cubic",
      "cubic",
      "cubic",
      "cubic",
    ]);
    expect(created.bounds?.min).toEqual({ x: 10, y: 20 });
    expect(created.bounds?.max).toEqual({ x: 210, y: 120 });
    expect(created.closed).toBe(true);
    expect(editor.selection.ids).toEqual([created.id]);
    expect(editor.toolIf("select")?.state).toEqual({ type: "ready" });
  });

  it("escape mid-drag discards the preview without committing a contour", () => {
    const contoursBefore = contours().length;

    editor.pointerDown(10, 10);
    editor.pointerMove(50, 30);
    editor.pointerMove(110, 90);
    editor.escape();

    expect(contours().length).toBe(contoursBefore);
    expect(editor.toolIf("shape")?.state.type).toBe("ready");
  });

  it("drag smaller than the 3-unit minimum does not commit", () => {
    const contoursBefore = contours().length;

    editor.pointerDown(10, 10);
    editor.pointerMove(14, 14);
    editor.pointerMove(12, 12);
    editor.pointerUp(12, 12);

    expect(contours().length).toBe(contoursBefore);
  });

  it("a committed rectangle is one undo step", async () => {
    await editor.dragScene({
      down: { x: 10, y: 10 },
      start: { x: 50, y: 30 },
      end: { x: 110, y: 90 },
    });
    expect(contours().length).toBe(1);

    await editor.undo();
    expect(contours().length).toBe(0);
  });
});

describe.each(["rectangle", "ellipse"] as const)("%s drawing lifecycle", (kind) => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("shape");
    editor.toolRegistry
      .get("shape")!
      .menuItems!.find((item) => item.id === kind)!
      .onSelect();
  });

  it.each([
    { x: 210, y: 120 },
    { x: -190, y: 120 },
    { x: 210, y: -80 },
    { x: -190, y: -80 },
  ])("creates tight bounds in every drag direction: %j", async (end) => {
    await editor.dragScene({ down: { x: 10, y: 20 }, start: { x: 80, y: 60 }, end });
    const bounds = editor.glyphContours[0].bounds;
    expect(bounds?.min).toEqual({ x: Math.min(10, end.x), y: Math.min(20, end.y) });
    expect(bounds?.max).toEqual({ x: Math.max(10, end.x), y: Math.max(20, end.y) });
  });

  it("uses the same geometry for preview paths and committed contours", async () => {
    const shape = kind === "ellipse" ? new Ellipse() : new Rectangle();
    const bounds = Rect.fromPoints({ x: 10, y: 20 }, { x: 210, y: 120 });
    const preview = ContourPath.fromPoints(shape.createPoints(bounds), true);
    await editor.dragScene({
      down: { x: 10, y: 20 },
      start: { x: 80, y: 60 },
      end: { x: 210, y: 120 },
    });
    const committed = ContourPath.fromContour(editor.glyphContours[0], Mat.Identity());
    expect(committed.commands).toEqual(preview.commands);
    expect(committed.bounds).toEqual(preview.bounds);
  });

  it.each([1, -1])(
    "constrains Shift drags to equal dimensions in direction %i",
    async (direction) => {
      await editor.dragScene({
        down: { x: 10, y: 20 },
        start: { x: 80, y: 60 },
        end: { x: 10 + direction * 200, y: 20 + direction * 100 },
        options: { shiftKey: true },
      });
      const bounds = editor.glyphContours[0].bounds!;
      expect(bounds.max.x - bounds.min.x).toBeCloseTo(200);
      expect(bounds.max.y - bounds.min.y).toBeCloseTo(200);
    },
  );

  it("discards live draft geometry and restores handles on Escape", () => {
    editor.pointerDown(10, 10).pointerMove(100, 60);
    const contour = editor.glyphContours[0];
    expect(editor.toolIf("shape")?.state.type).toBe("dragging");
    expect(editor.selection.ids).toEqual([contour.id]);
    expect(editor.handlesVisible(contour.id)).toBe(false);
    editor.escape();
    expect(editor.toolIf("shape")?.state.type).toBe("ready");
    expect(editor.glyphContours).toHaveLength(0);
    expect(editor.selection.ids).toEqual([]);
    expect(editor.handlesVisible(contour.id)).toBe(true);
  });

  it("publishes live selection bounds and retains draft identity on release", async () => {
    editor.pointerDown(10, 10).pointerMove(100, 60);
    const contour = editor.glyphContours[0];
    const bounds = editor.selectionBoundsCell.peek()!;
    expect(bounds.width).toBeGreaterThan(0);
    editor.pointerMove(200, 90);
    expect(editor.selectionBoundsCell.peek()!.width).toBeGreaterThan(bounds.width);
    const points = editor.glyphContours[0].points;
    editor.pointerUp(200, 90);
    await editor.settle();
    expect(editor.glyphContours[0].id).toBe(contour.id);
    expect(editor.glyphContours[0].points).toEqual(points);
    expect(editor.handlesVisible(contour.id)).toBe(true);
  });

  it("updates the live dimensions when Shift changes without pointer movement", () => {
    editor.pointerDown(10, 10).pointerMove(110, 60);
    const bounds = editor.selectionBoundsCell.peek()!;
    expect(bounds.width).not.toBeCloseTo(bounds.height);
    editor.keyDown("Shift", { shiftKey: true });
    const constrained = editor.selectionBoundsCell.peek()!;
    expect(constrained.width).toBeCloseTo(constrained.height);
    editor.escape();
  });

  it("leaves other contours visible and restores the previous selection on cancellation", async () => {
    await editor.dragScene({
      down: { x: 0, y: 0 },
      start: { x: 50, y: 50 },
      end: { x: 100, y: 100 },
    });
    const selection = editor.selection.ids;
    const original = editor.glyphContours[0];
    editor.selectTool("shape").pointerDown(10, 10).pointerMove(100, 60);
    expect(editor.glyphContours).toHaveLength(2);
    expect(editor.handlesVisible(original.id)).toBe(true);
    editor.escape();
    expect(editor.glyphContours).toHaveLength(1);
    expect(editor.selection.ids).toEqual(selection);
  });

  it("cancels the draft and restores handles when switching tools", () => {
    editor.pointerDown(10, 10).pointerMove(100, 60);
    const contourId = editor.glyphContours[0].id;
    editor.selectTool("select");
    expect(editor.glyphContours).toHaveLength(0);
    expect(editor.handlesVisible(contourId)).toBe(true);
    expect(editor.selection.ids).toEqual([]);
  });

  it("rejects a final drag smaller than three glyph units", async () => {
    await editor.dragScene({
      down: { x: 10, y: 20 },
      start: { x: 80, y: 60 },
      end: { x: 12, y: 100 },
    });
    expect(editor.glyphContours).toHaveLength(0);
    expect(editor.toolIf("shape")?.state.type).toBe("ready");
  });

  it("restores the complete shape through a single undo and redo", async () => {
    await editor.dragScene({
      down: { x: 10, y: 20 },
      start: { x: 80, y: 60 },
      end: { x: 210, y: 120 },
    });
    const points = editor.glyphContours[0].points;
    const selection = editor.selection.ids;
    await editor.undo();
    expect(editor.glyphContours).toHaveLength(0);
    expect(editor.selection.ids).toEqual([]);
    await editor.redo();
    expect(editor.glyphContours[0].points).toEqual(points);
    expect(editor.glyphContours[0].closed).toBe(true);
    expect(editor.selection.ids).toEqual(selection);
  });
});
