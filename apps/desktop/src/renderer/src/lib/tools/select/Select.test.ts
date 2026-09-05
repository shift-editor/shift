import { describe, it, expect, beforeEach } from "vitest";
import { isPointId, type PointId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";
import { SELECT_BOUNDING_BOX_STYLE } from "./BoundingBox";
import { Select } from "./Select";
import { LOCK_GAP_PX, LOCK_SIZE_PX } from "@/lib/editor/rendering/icons/lock";

// Restored from the WS6 behavioral inventory (git show ef037c6e^).
describe("Select tool", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    editor.selectTool("select");
  });

  describe("selection", () => {
    it("selects a point when clicking on it", async () => {
      editor.selectTool("pen");
      await editor.click(100, 200);
      editor.selectTool("select");

      await editor.click(100, 200);
      expect(editor.selection.ids.some(isPointId)).toBe(true);
    });

    it("clears selection when clicking empty space", async () => {
      editor.selectTool("pen");
      await editor.click(100, 200);
      editor.selectTool("select");

      await editor.click(100, 200);
      await editor.click(9999, 9999);
      expect(editor.selection.hasSelection()).toBe(false);
    });

    describe("Shift-click selection", () => {
      let firstId: PointId;
      let secondId: PointId;

      beforeEach(async () => {
        const pointIds = await editor.drawOpenContour([
          { x: 100, y: 100 },
          { x: 200, y: 200 },
        ]);
        if (!pointIds[0] || !pointIds[1]) throw new Error("Expected two points");
        [firstId, secondId] = pointIds;
        editor.selectTool("select");
      });

      it("adds an unselected point without clearing the current selection", async () => {
        await editor.clickGlyphLocal(100, 100);
        await editor.clickGlyphLocal(200, 200, { shiftKey: true });

        expect(editor.selection.has(firstId)).toBe(true);
        expect(editor.selection.has(secondId)).toBe(true);
        expect(editor.selection.ids).toHaveLength(2);
      });

      it("removes a selected point while preserving the other selection", async () => {
        editor.selection.select([firstId, secondId]);

        await editor.clickGlyphLocal(100, 100, { shiftKey: true });

        expect(editor.selection.has(firstId)).toBe(false);
        expect(editor.selection.has(secondId)).toBe(true);
        expect(editor.selection.ids).toHaveLength(1);
      });

      it("preserves the current selection when clicking empty canvas", async () => {
        editor.selection.select([firstId, secondId]);

        await editor.click(9999, 9999, { shiftKey: true });

        expect(editor.selection.has(firstId)).toBe(true);
        expect(editor.selection.has(secondId)).toBe(true);
        expect(editor.selection.ids).toHaveLength(2);
      });

      it("adds an unselected segment", async () => {
        const segmentId = editor.requireGlyphLayer().contours[0]?.segments()[0]?.id;
        if (!segmentId) throw new Error("Expected segment");

        await editor.clickGlyphLocal(150, 150, { shiftKey: true });

        expect(editor.selection.has(segmentId)).toBe(true);
      });

      it("removes a selected segment", async () => {
        const segmentId = editor.requireGlyphLayer().contours[0]?.segments()[0]?.id;
        if (!segmentId) throw new Error("Expected segment");
        editor.selection.select([segmentId]);

        await editor.clickGlyphLocal(150, 150, { shiftKey: true });

        expect(editor.selection.has(segmentId)).toBe(false);
      });

      it("adds an unselected anchor", async () => {
        const anchorId = editor.requireGlyphLayer().addAnchor("top", { x: 300, y: 300 });
        await editor.settle();

        await editor.clickGlyphLocal(300, 300, { shiftKey: true });

        expect(editor.selection.has(anchorId)).toBe(true);
      });

      it("removes a selected anchor", async () => {
        const anchorId = editor.requireGlyphLayer().addAnchor("top", { x: 300, y: 300 });
        await editor.settle();
        editor.selection.select([anchorId]);

        await editor.clickGlyphLocal(300, 300, { shiftKey: true });

        expect(editor.selection.has(anchorId)).toBe(false);
      });
    });

    it("drags a selected point", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 200);
      editor.selectTool("select");

      await editor.clickGlyphLocal(100, 200);

      const [pointId] = editor.selection.ids.filter(isPointId);
      if (!pointId) throw new Error("Expected selected point");

      const before = editor.pointPosition(pointId);

      const drag = await editor.dragScene({
        down: before,
        start: { x: before.x + 4, y: before.y },
        end: { x: before.x + 40, y: before.y + 30 },
      });

      const after = editor.pointPosition(pointId);

      expect(after.x).toBeCloseTo(before.x + drag.delta.x);
      expect(after.y).toBeCloseTo(before.y + drag.delta.y);
    });

    it("commits the latest queued move when releasing a selected point before the next frame", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 200);
      editor.selectTool("select");
      await editor.clickGlyphLocal(100, 200);

      const pointId = editor.selection.ids.find(isPointId);
      if (!pointId) throw new Error("Expected selected point");
      const before = editor.pointPosition(pointId);
      const down = editor.projectSceneToScreen(before);
      const start = editor.projectSceneToScreen({ x: before.x + 10, y: before.y });
      const end = editor.projectSceneToScreen({ x: before.x + 50, y: before.y + 30 });
      const modifiers = { shiftKey: false, altKey: false, metaKey: false };

      editor.pointerDown(down.x, down.y);
      editor.toolManager.handlePointerMove(start, modifiers);
      editor.toolManager.flushPointerMoves();
      editor.toolManager.handlePointerMove(end, modifiers);
      editor.pointerUp(end.x, end.y);
      editor.toolManager.flushPointerMoves();
      await editor.settle();

      expect(editor.pointPosition(pointId)).toEqual({ x: before.x + 50, y: before.y + 30 });
    });

    it("commits a selected-point drag whose only queued move crosses the threshold", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 200);
      editor.selectTool("select");
      await editor.clickGlyphLocal(100, 200);

      const pointId = editor.selection.ids.find(isPointId);
      if (!pointId) throw new Error("Expected selected point");
      const before = editor.pointPosition(pointId);
      const down = editor.projectSceneToScreen(before);
      const end = editor.projectSceneToScreen({ x: before.x + 50, y: before.y + 30 });

      editor.pointerDown(down.x, down.y);
      editor.toolManager.handlePointerMove(end, {
        shiftKey: false,
        altKey: false,
        metaKey: false,
      });
      editor.pointerUp(end.x, end.y);
      await editor.settle();

      expect(editor.pointPosition(pointId)).toEqual({ x: before.x + 50, y: before.y + 30 });
    });

    it("drags an unselected point from the pointer-down handle", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 200);
      editor.selectTool("select");

      const layer = editor.requireGlyphLayer();
      const point = layer.contours[0]?.points[0];
      if (!point) throw new Error("Expected point");

      const before = editor.pointPosition(point.id);
      const drag = await editor.dragScene({
        down: before,
        start: { x: before.x + 80, y: before.y },
        end: { x: before.x + 110, y: before.y + 30 },
      });

      const after = editor.pointPosition(point.id);

      expect(editor.selection.has(point.id)).toBe(true);
      expect(after.x).toBeCloseTo(before.x + drag.delta.x);
      expect(after.y).toBeCloseTo(before.y + drag.delta.y);
    });

    it("drags a Pen curve's untouched control independently from its corner", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 100);
      await editor.dragScene({
        down: { x: 300, y: 100 },
        start: { x: 340, y: 120 },
        end: { x: 380, y: 180 },
      });

      const cubic = editor.openContour?.segments()[0]?.asCubic();
      if (!cubic) throw new Error("Expected cubic segment");
      const controlBefore = editor.pointPosition(cubic.controlStart.id);
      const cornerBefore = editor.pointPosition(cubic.start.id);
      editor.selectTool("select");

      const drag = await editor.dragScene({
        down: controlBefore,
        start: { x: controlBefore.x + 10, y: controlBefore.y },
        end: { x: controlBefore.x + 60, y: controlBefore.y + 30 },
      });

      expect(editor.pointPosition(cubic.controlStart.id)).toEqual({
        x: controlBefore.x + drag.delta.x,
        y: controlBefore.y + drag.delta.y,
      });
      expect(editor.pointPosition(cubic.start.id)).toEqual(cornerBefore);
    });

    it("shows a bounding box for one selected segment with area", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 200);
      await editor.clickGlyphLocal(180, 240);
      editor.selectTool("select");
      await editor.clickGlyphLocal(140, 220);

      const select = editor.toolManager.activeTool;
      if (!(select instanceof Select)) throw new Error("Expected Select tool");

      expect(select.boundingBox.visible).toBe(true);
    });

    it("shows a bounding box when both dimensions are small but nonzero", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 100);
      await editor.clickGlyphLocal(112, 112);
      const pointIds = editor.requireGlyphLayer().allPoints.map((point) => point.id);
      editor.selection.select(pointIds);
      editor.selectTool("select");

      const select = editor.toolManager.activeTool;
      if (!(select instanceof Select)) throw new Error("Expected Select tool");
      expect(select.boundingBox.visible).toBe(true);
    });

    it.each([
      ["horizontal", { x: 100, y: 200 }, { x: 180, y: 200 }, { x: 140, y: 200 }],
      ["vertical", { x: 100, y: 100 }, { x: 100, y: 200 }, { x: 100, y: 150 }],
    ] as const)(
      "hides the bounding box for an exactly %s segment",
      async (_name, start, end, hit) => {
        editor.selectTool("pen");
        await editor.clickGlyphLocal(start.x, start.y);
        await editor.clickGlyphLocal(end.x, end.y);
        editor.selectTool("select");
        await editor.clickGlyphLocal(hit.x, hit.y);

        const select = editor.toolManager.activeTool;
        if (!(select instanceof Select)) throw new Error("Expected Select tool");
        expect(select.boundingBox.visible).toBe(false);
      },
    );

    it.each([
      ["horizontal", { x: 100, y: 200 }, { x: 180, y: 205 }, { x: 140, y: 202.5 }],
      ["vertical", { x: 100, y: 100 }, { x: 105, y: 200 }, { x: 102.5, y: 150 }],
    ] as const)(
      "shows the normal bounding box for a nearly %s segment",
      async (_name, start, end, hit) => {
        editor.selectTool("pen");
        await editor.clickGlyphLocal(start.x, start.y);
        await editor.clickGlyphLocal(end.x, end.y);
        editor.selectTool("select");
        await editor.clickGlyphLocal(hit.x, hit.y);

        const select = editor.toolManager.activeTool;
        if (!(select instanceof Select)) throw new Error("Expected Select tool");
        expect(select.boundingBox.visible).toBe(true);
      },
    );

    it("shows the move cursor inside the current bounding box", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 100);
      await editor.clickGlyphLocal(200, 200);
      editor.selectTool("select");
      await editor.clickGlyphLocal(100, 100);
      await editor.clickGlyphLocal(200, 200, { shiftKey: true });

      const inside = editor.projectSceneToScreen({ x: 120, y: 180 });
      editor.pointerMove(inside.x, inside.y);

      expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "move" });
    });

    it("drags the current selection from inside its bounding box", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 100);
      await editor.clickGlyphLocal(200, 200);

      const layer = editor.requireGlyphLayer();
      const [first, second] = layer.contours[0]?.points ?? [];
      if (!first || !second) throw new Error("Expected selected points");

      editor.selection.select([first.id, second.id]);
      editor.selectTool("select");

      const beforeFirst = editor.pointPosition(first.id);
      const beforeSecond = editor.pointPosition(second.id);
      const drag = await editor.dragScene({
        down: { x: 120, y: 180 },
        start: { x: 124, y: 180 },
        end: { x: 150, y: 220 },
      });

      const afterFirst = editor.pointPosition(first.id);
      const afterSecond = editor.pointPosition(second.id);

      expect(afterFirst.x).toBeCloseTo(beforeFirst.x + drag.delta.x);
      expect(afterFirst.y).toBeCloseTo(beforeFirst.y + drag.delta.y);
      expect(afterSecond.x).toBeCloseTo(beforeSecond.x + drag.delta.x);
      expect(afterSecond.y).toBeCloseTo(beforeSecond.y + drag.delta.y);
    });

    it("resizes the current selection from the pointer-down bounding-box handle", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 100);
      await editor.clickGlyphLocal(200, 200);

      const layer = editor.requireGlyphLayer();
      const [first, second] = layer.contours[0]?.points ?? [];
      if (!first || !second) throw new Error("Expected selected points");

      editor.selection.select([first.id, second.id]);
      editor.selectTool("select");

      const bounds = editor.selectionBounds();
      if (!bounds) throw new Error("Expected selection bounds");

      await editor.dragScene({
        down: { x: bounds.right, y: bounds.bottom },
        start: { x: bounds.right + 60, y: bounds.bottom },
        end: { x: bounds.right + 50, y: bounds.bottom + 50 },
      });

      const firstAfter = editor.pointPosition(first.id);
      const secondAfter = editor.pointPosition(second.id);

      expect(firstAfter.x).toBeCloseTo(100);
      expect(firstAfter.y).toBeCloseTo(100);
      expect(secondAfter.x).toBeCloseTo(250);
      expect(secondAfter.y).toBeCloseTo(250);
    });

    describe("constrained resize release", () => {
      beforeEach(async () => {
        const ids = await editor.drawOpenContour([
          { x: 100, y: 100 },
          { x: 200, y: 200 },
        ]);
        editor.selection.select(ids);
        editor.selectTool("select");
      });

      it.each([true, false])(
        "commits the visible preview with Shift held=%s at release",
        async (shiftKey) => {
          const layer = editor.requireGlyphLayer();
          const down = editor.projectSceneToScreen({ x: 200, y: 200 });
          const end = editor.projectSceneToScreen({ x: 250, y: 225 });
          editor.pointerDown(down.x, down.y, { shiftKey: true });
          editor.pointerMove(end.x, end.y, { shiftKey: true });
          expect(editor.toolManager.activeTool?.state.type).toBe("resizing");

          const preview = layer.contours[0]!.points.map(({ x, y }) => ({ x, y }));
          expect(preview).toEqual([
            { x: 100, y: 100 },
            { x: 250, y: 250 },
          ]);
          editor.pointerUp(end.x, end.y, { shiftKey });
          await editor.settle();

          expect(layer.contours[0]!.points.map(({ x, y }) => ({ x, y }))).toEqual(preview);
        },
      );

      it("uses the release position with the last preview constraints and preserves undo", async () => {
        const layer = editor.requireGlyphLayer();
        const down = editor.projectSceneToScreen({ x: 200, y: 200 });
        const move = editor.projectSceneToScreen({ x: 250, y: 225 });
        const up = editor.projectSceneToScreen({ x: 275, y: 230 });
        editor.pointerDown(down.x, down.y).pointerMove(move.x, move.y, { shiftKey: true });
        editor.pointerUp(up.x, up.y);
        await editor.settle();
        expect(layer.contours[0]!.points.map(({ x, y }) => ({ x, y }))).toEqual([
          { x: 100, y: 100 },
          { x: 275, y: 275 },
        ]);

        await editor.undo();
        expect(layer.contours[0]!.points.map(({ x, y }) => ({ x, y }))).toEqual([
          { x: 100, y: 100 },
          { x: 200, y: 200 },
        ]);
        await editor.redo();
        expect(layer.contours[0]!.points.map(({ x, y }) => ({ x, y }))).toEqual([
          { x: 100, y: 100 },
          { x: 275, y: 275 },
        ]);
      });

      it("removes the constraint when dragging continues without Shift", async () => {
        const layer = editor.requireGlyphLayer();
        const down = editor.projectSceneToScreen({ x: 200, y: 200 });
        const move = editor.projectSceneToScreen({ x: 250, y: 225 });
        const end = editor.projectSceneToScreen({ x: 275, y: 230 });
        editor.pointerDown(down.x, down.y).pointerMove(move.x, move.y, { shiftKey: true });
        editor.pointerMove(end.x, end.y).pointerUp(end.x, end.y, { shiftKey: true });
        await editor.settle();

        expect(layer.contours[0]!.points.map(({ x, y }) => ({ x, y }))).toEqual([
          { x: 100, y: 100 },
          { x: 275, y: 230 },
        ]);
      });

      it("uses the modifiers from a queued movement drained at mouseup", async () => {
        const layer = editor.requireGlyphLayer();
        const down = editor.projectSceneToScreen({ x: 200, y: 200 });
        const move = editor.projectSceneToScreen({ x: 250, y: 225 });
        editor.pointerDown(down.x, down.y);
        editor.toolManager.handlePointerMove(move, { shiftKey: true, altKey: false });
        editor.pointerUp(move.x, move.y);
        await editor.settle();

        expect(layer.contours[0]!.points.map(({ x, y }) => ({ x, y }))).toEqual([
          { x: 100, y: 100 },
          { x: 250, y: 250 },
        ]);
      });
    });

    it("rotates the current selection from the pointer-down bounding-box zone", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 100);
      await editor.clickGlyphLocal(200, 200);

      const layer = editor.requireGlyphLayer();
      const [first, second] = layer.contours[0]?.points ?? [];
      if (!first || !second) throw new Error("Expected selected points");

      editor.selection.select([first.id, second.id]);
      editor.selectTool("select");

      const bounds = editor.selectionBounds();
      if (!bounds) throw new Error("Expected selection bounds");

      const offset = SELECT_BOUNDING_BOX_STYLE.rotationZoneOffsetPx;
      await editor.dragScene({
        down: { x: bounds.right + offset, y: bounds.bottom + offset },
        start: { x: bounds.right + offset + 40, y: bounds.bottom + offset + 40 },
        end: { x: bounds.left - offset, y: bounds.bottom + offset },
      });

      const firstAfter = editor.pointPosition(first.id);
      const secondAfter = editor.pointPosition(second.id);

      expect(firstAfter.x).toBeCloseTo(200);
      expect(firstAfter.y).toBeCloseTo(100);
      expect(secondAfter.x).toBeCloseTo(100);
      expect(secondAfter.y).toBeCloseTo(200);
    });

    it("drags a segment by its endpoints", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 200);
      await editor.clickGlyphLocal(180, 200);

      const layer = editor.requireGlyphLayer();
      const [first, second] = layer.contours[0]?.points ?? [];
      if (!first || !second) throw new Error("Expected line segment points");

      const beforeFirst = editor.pointPosition(first.id);
      const beforeSecond = editor.pointPosition(second.id);
      const midpoint = {
        x: (beforeFirst.x + beforeSecond.x) / 2,
        y: (beforeFirst.y + beforeSecond.y) / 2,
      };

      editor.selectTool("select");
      const drag = await editor.dragScene({
        down: midpoint,
        start: { x: midpoint.x + 4, y: midpoint.y },
        end: { x: midpoint.x + 30, y: midpoint.y + 20 },
      });

      const afterFirst = editor.pointPosition(first.id);
      const afterSecond = editor.pointPosition(second.id);

      expect(afterFirst.x).toBeCloseTo(beforeFirst.x + drag.delta.x);
      expect(afterFirst.y).toBeCloseTo(beforeFirst.y + drag.delta.y);
      expect(afterSecond.x).toBeCloseTo(beforeSecond.x + drag.delta.x);
      expect(afterSecond.y).toBeCloseTo(beforeSecond.y + drag.delta.y);
    });

    it("duplicates the current selection at the same position", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 100);
      await editor.clickGlyphLocal(200, 100);

      const layer = editor.requireGlyphLayer();
      const [first, second] = layer.contours[0]?.points ?? [];
      if (!first || !second) throw new Error("Expected selected points");

      editor.selection.select([first.id, second.id]);
      editor.selectTool("select");

      const duplicated = editor.duplicateSelection();
      await editor.settle();

      expect(layer.allPoints).toHaveLength(4);
      expect(duplicated).toHaveLength(2);

      const [duplicatedFirst, duplicatedSecond] = duplicated;
      if (!duplicatedFirst || !duplicatedSecond) throw new Error("Expected duplicated points");

      expect(editor.pointPosition(duplicatedFirst)).toEqual({ x: first.x, y: first.y });
      expect(editor.pointPosition(duplicatedSecond)).toEqual({ x: second.x, y: second.y });
    });

    it("upgrades a line segment to a cubic with alt-click", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 200);
      await editor.clickGlyphLocal(190, 230);

      const layer = editor.requireGlyphLayer();
      expect(layer.contours[0]?.segments()[0]?.type).toBe("line");

      editor.selectTool("select");
      await editor.clickGlyphLocal(130, 210, { altKey: true });

      expect(layer.contours[0]?.segments()[0]?.type).toBe("cubic");
      expect(layer.allPoints).toHaveLength(4);
    });

    it("bends a cubic segment with meta-drag", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 200);
      await editor.clickGlyphLocal(190, 230);

      const layer = editor.requireGlyphLayer();
      const segment = layer.contours[0]?.segments()[0];
      if (!segment) throw new Error("Expected line segment");
      expect(layer.upgradeLineToCubic(segment.id)).toBe(true);
      await editor.settle();

      const cubic = layer.contours[0]?.segments()[0]?.asCubic();
      if (!cubic) throw new Error("Expected cubic segment");

      const beforeControlStart = editor.pointPosition(cubic.controlStart.id);
      const beforeControlEnd = editor.pointPosition(cubic.controlEnd.id);
      const bendPoint = layer.contours[0]?.segments()[0]?.pointAt(0.5);
      if (!bendPoint) throw new Error("Expected cubic bend point");

      editor.selectTool("select");
      await editor.dragScene({
        down: bendPoint,
        start: { x: bendPoint.x + 4, y: bendPoint.y },
        end: { x: bendPoint.x + 4, y: bendPoint.y + 40 },
        options: { metaKey: true },
      });

      const afterControlStart = editor.pointPosition(cubic.controlStart.id);
      const afterControlEnd = editor.pointPosition(cubic.controlEnd.id);

      expect(afterControlStart.y).toBeGreaterThan(beforeControlStart.y);
      expect(afterControlEnd.y).toBeGreaterThan(beforeControlEnd.y);
    });

    it("toggles a point smooth with double-click", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 200);

      const layer = editor.requireGlyphLayer();
      const point = layer.allPoints[0];
      if (!point) throw new Error("Expected point");

      editor.selectTool("select");
      await editor.clickGlyphLocal(point.x, point.y);
      await editor.clickGlyphLocal(point.x, point.y);

      expect(layer.point(point.id)?.smooth).toBe(true);
    });

    it("finishes a marquee whose threshold-crossing move is still queued", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 200);
      await editor.clickGlyphLocal(180, 200);

      const [inside, outside] = editor.requireGlyphLayer().contours[0]?.points ?? [];
      if (!inside || !outside) throw new Error("Expected line segment points");
      const down = editor.projectSceneToScreen({ x: 80, y: 180 });
      const end = editor.projectSceneToScreen({ x: 130, y: 230 });

      editor.selectTool("select");
      editor.pointerDown(down.x, down.y);
      editor.toolManager.handlePointerMove(end, {
        shiftKey: false,
        altKey: false,
        metaKey: false,
      });
      editor.pointerUp(end.x, end.y);
      editor.toolManager.flushPointerMoves();

      expect(editor.selection.has(inside.id)).toBe(true);
      expect(editor.selection.has(outside.id)).toBe(false);
    });

    it("marquee-selects points inside the brushed rectangle", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 200);
      await editor.clickGlyphLocal(180, 200);

      const layer = editor.requireGlyphLayer();
      const [inside, outside] = layer.contours[0]?.points ?? [];
      if (!inside || !outside) throw new Error("Expected line segment points");

      editor.selectTool("select");
      await editor.dragScene({
        down: { x: 80, y: 180 },
        start: { x: 84, y: 180 },
        end: { x: 130, y: 230 },
      });

      expect(editor.selection.has(inside.id)).toBe(true);
      expect(editor.selection.has(outside.id)).toBe(false);
    });
  });
});

describe("Select tool in preview sessions", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor("preview");
    await editor.startSession();
    await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ]);
    editor.selectTool("select");
  });

  it("disables authoring tools while keeping Select available", () => {
    expect(editor.toolRegistry.get("select")?.disabled).toBeFalsy();
    expect(editor.toolRegistry.get("pen")?.disabled).toBe(true);
    expect(editor.toolRegistry.get("shape")?.disabled).toBe(true);
  });

  it("draws a marquee without hover or selection state", async () => {
    await editor.clickGlyphLocal(100, 100);
    expect(editor.selection.ids).toEqual([]);

    const pointScreen = editor.projectSceneToScreen({ x: 100, y: 100 });
    editor.pointerMove(pointScreen.x, pointScreen.y);
    expect(editor.hover.id).toBeNull();

    await editor.dragScene({
      down: { x: 80, y: 80 },
      start: { x: 84, y: 80 },
      end: { x: 150, y: 150 },
    });
    expect(editor.selection.ids).toEqual([]);
    expect(editor.toolCell.peek()?.state.type).toBe("ready");
  });

  it("treats the preview lock as ordinary empty canvas", async () => {
    const view = editor.sceneGlyphRenderModel;
    const node = editor.glyphNode;
    if (!view || !node) throw new Error("Expected placed preview glyph");

    const metrics = editor.font.metricsForSource(editor.font.defaultSource.id);
    const size = editor.camera.screenToUpmDistance(LOCK_SIZE_PX);
    const gap = editor.camera.screenToUpmDistance(LOCK_GAP_PX);
    const lockPoint = {
      x: node.position.x + view.xAdvanceCell.peek() / 2,
      y: node.position.y + metrics.descender - gap - size / 2,
    };
    expect(editor.getPointerTarget(lockPoint).kind).toBe("canvas");
    await editor.clickGlyphLocal(lockPoint.x, lockPoint.y);

    expect(editor.selection.ids).toEqual([]);
    expect(editor.toolCell.peek()?.state.type).toBe("ready");
  });
});
