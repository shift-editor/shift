import { beforeEach, describe, expect, it } from "vitest";
import type { PointId } from "@shift/types";
import type { GlyphLayer } from "@/lib/model/Glyph";
import { TestEditor } from "@/testing/TestEditor";

describe("Select movement preserves selected geometry", () => {
  let editor: TestEditor;
  let layer: GlyphLayer;
  let firstId: PointId;
  let middleId: PointId;
  let lastId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    [firstId, middleId, lastId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 150, y: 150 },
      { x: 200, y: 200 },
    ]);
    layer = editor.requireGlyphLayer();
    editor.selectTool("select");
  });

  it("moves every point when dragging one point in a multi-point selection", async () => {
    editor.selection.select([firstId, middleId, lastId]);

    const drag = await editor.dragScene({
      down: editor.pointPosition(middleId),
      start: { x: 154, y: 150 },
      end: { x: 190, y: 180 },
    });

    expect(editor.pointPosition(firstId)).toEqual({ x: 100 + drag.delta.x, y: 100 + drag.delta.y });
    expect(editor.pointPosition(middleId)).toEqual({
      x: 150 + drag.delta.x,
      y: 150 + drag.delta.y,
    });
    expect(editor.pointPosition(lastId)).toEqual({ x: 200 + drag.delta.x, y: 200 + drag.delta.y });
  });

  it("selects and moves an anchor dragged directly", async () => {
    const anchorId = layer.addAnchor("top", { x: 300, y: 300 });
    await editor.settle();

    const drag = await editor.dragScene({
      down: editor.anchorPosition(anchorId),
      start: { x: 304, y: 300 },
      end: { x: 330, y: 320 },
    });

    expect(editor.selection.has(anchorId)).toBe(true);
    expect(editor.anchorPosition(anchorId)).toEqual({
      x: 300 + drag.delta.x,
      y: 300 + drag.delta.y,
    });
  });

  it("moves selected points and anchors together", async () => {
    const anchorId = layer.addAnchor("top", { x: 300, y: 300 });
    await editor.settle();
    editor.selection.select([firstId, middleId, anchorId]);

    const drag = await editor.dragScene({
      down: editor.pointPosition(middleId),
      start: { x: 154, y: 150 },
      end: { x: 180, y: 170 },
    });

    expect(editor.pointPosition(firstId)).toEqual({ x: 100 + drag.delta.x, y: 100 + drag.delta.y });
    expect(editor.pointPosition(middleId)).toEqual({
      x: 150 + drag.delta.x,
      y: 150 + drag.delta.y,
    });
    expect(editor.anchorPosition(anchorId)).toEqual({
      x: 300 + drag.delta.x,
      y: 300 + drag.delta.y,
    });
  });

  it("moves contour points once when contour and point identities are selected", async () => {
    const contour = layer.contours[0];
    if (!contour) throw new Error("Expected contour");
    editor.selection.select([contour.id, firstId, middleId, lastId]);

    const drag = await editor.dragScene({
      down: editor.pointPosition(middleId),
      start: { x: 154, y: 150 },
      end: { x: 180, y: 170 },
    });

    expect(editor.pointPosition(firstId)).toEqual({ x: 100 + drag.delta.x, y: 100 + drag.delta.y });
    expect(editor.pointPosition(middleId)).toEqual({
      x: 150 + drag.delta.x,
      y: 150 + drag.delta.y,
    });
    expect(editor.pointPosition(lastId)).toEqual({ x: 200 + drag.delta.x, y: 200 + drag.delta.y });
  });

  it("restores every previewed position when Escape cancels movement", () => {
    editor.selection.select([firstId, middleId, lastId]);
    const down = editor.projectSceneToScreen(editor.pointPosition(middleId));
    const start = editor.projectSceneToScreen({ x: 154, y: 150 });
    const end = editor.projectSceneToScreen({ x: 190, y: 180 });

    editor.pointerDown(down.x, down.y).pointerMove(start.x, start.y).pointerMove(end.x, end.y);
    expect(editor.pointPosition(middleId)).not.toEqual({ x: 150, y: 150 });
    editor.escape();

    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
    expect(editor.pointPosition(middleId)).toEqual({ x: 150, y: 150 });
    expect(editor.pointPosition(lastId)).toEqual({ x: 200, y: 200 });
  });

  it("commits movement as one undoable and redoable edit", async () => {
    editor.selection.select([firstId, middleId, lastId]);
    await editor.dragScene({
      down: editor.pointPosition(middleId),
      start: { x: 154, y: 150 },
      end: { x: 190, y: 180 },
    });
    const moved = [
      editor.pointPosition(firstId),
      editor.pointPosition(middleId),
      editor.pointPosition(lastId),
    ];

    await editor.undo();
    expect([
      editor.pointPosition(firstId),
      editor.pointPosition(middleId),
      editor.pointPosition(lastId),
    ]).toEqual([
      { x: 100, y: 100 },
      { x: 150, y: 150 },
      { x: 200, y: 200 },
    ]);

    await editor.redo();
    expect([
      editor.pointPosition(firstId),
      editor.pointPosition(middleId),
      editor.pointPosition(lastId),
    ]).toEqual(moved);
  });

  it("recomputes each preview from the interaction base", () => {
    editor.selection.select([firstId]);
    const down = editor.projectSceneToScreen(editor.pointPosition(firstId));
    const start = editor.projectSceneToScreen({ x: 104, y: 100 });
    const first = editor.projectSceneToScreen({ x: 120, y: 100 });
    const second = editor.projectSceneToScreen({ x: 130, y: 100 });

    editor.pointerDown(down.x, down.y).pointerMove(start.x, start.y).pointerMove(first.x, first.y);
    const firstPreview = editor.pointPosition(firstId);
    editor.pointerMove(second.x, second.y);
    const secondPreview = editor.pointPosition(firstId);
    editor.escape();

    expect(secondPreview.x - firstPreview.x).toBeCloseTo(10);
    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
  });

  it("moves both neighboring handles with a dragged smooth point", async () => {
    for (const segment of layer.contours[0]?.segments() ?? []) {
      expect(layer.upgradeLineToCubic(segment.id)).toBe(true);
    }
    layer.toggleSmooth(middleId);
    await editor.settle();

    const cubics = layer.contours[0]?.segments().map((segment) => segment.asCubic()) ?? [];
    const incoming = cubics.find((segment) => segment?.end.id === middleId);
    const outgoing = cubics.find((segment) => segment?.start.id === middleId);
    if (!incoming || !outgoing) throw new Error("Expected cubic neighbors");
    const incomingBefore = editor.pointPosition(incoming.controlEnd.id);
    const outgoingBefore = editor.pointPosition(outgoing.controlStart.id);

    const drag = await editor.dragScene({
      down: editor.pointPosition(middleId),
      start: { x: 154, y: 150 },
      end: { x: 180, y: 170 },
    });

    expect(editor.pointPosition(incoming.controlEnd.id)).toEqual({
      x: incomingBefore.x + drag.delta.x,
      y: incomingBefore.y + drag.delta.y,
    });
    expect(editor.pointPosition(outgoing.controlStart.id)).toEqual({
      x: outgoingBefore.x + drag.delta.x,
      y: outgoingBefore.y + drag.delta.y,
    });
  });

  it("does not move geometry before the drag threshold is crossed", async () => {
    const point = editor.projectSceneToScreen(editor.pointPosition(firstId));

    editor
      .pointerDown(point.x, point.y)
      .pointerMove(point.x + 2, point.y)
      .pointerUp(point.x + 2, point.y);
    await editor.settle();

    expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
    expect(editor.pointPosition(lastId)).toEqual({ x: 200, y: 200 });
  });
});
