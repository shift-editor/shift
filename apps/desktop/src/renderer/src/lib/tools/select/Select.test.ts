import { describe, it, expect, beforeEach } from "vitest";
import { isPointId } from "@shift/types";
import { TestEditor } from "@/testing/TestEditor";
import { SELECT_BOUNDING_BOX_STYLE } from "./BoundingBox";

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
      editor.click(100, 200);
      await editor.settle();
      editor.selectTool("select");

      editor.click(100, 200);
      expect(editor.selection.ids.some(isPointId)).toBe(true);
    });

    it("clears selection when clicking empty space", async () => {
      editor.selectTool("pen");
      editor.click(100, 200);
      await editor.settle();
      editor.selectTool("select");

      editor.click(100, 200);
      editor.click(9999, 9999);
      expect(editor.selection.hasSelection()).toBe(false);
    });

    it("drags a selected point", async () => {
      editor.selectTool("pen");
      editor.clickGlyphLocal(100, 200);
      await editor.settle();
      editor.selectTool("select");

      editor.clickGlyphLocal(100, 200);

      const [pointId] = editor.selection.ids.filter(isPointId);
      if (!pointId) throw new Error("Expected selected point");

      const before = editor.pointPosition(pointId);

      const drag = editor.dragScene({
        down: before,
        start: { x: before.x + 4, y: before.y },
        end: { x: before.x + 40, y: before.y + 30 },
      });
      await editor.settle();

      const after = editor.pointPosition(pointId);

      expect(after.x).toBeCloseTo(before.x + drag.delta.x);
      expect(after.y).toBeCloseTo(before.y + drag.delta.y);
    });

    it("drags an unselected point from the pointer-down handle", async () => {
      editor.selectTool("pen");
      editor.clickGlyphLocal(100, 200);
      await editor.settle();
      editor.selectTool("select");

      const layer = editor.requireGlyphLayer();
      const point = layer.contours[0]?.points[0];
      if (!point) throw new Error("Expected point");

      const before = editor.pointPosition(point.id);
      const drag = editor.dragScene({
        down: before,
        start: { x: before.x + 80, y: before.y },
        end: { x: before.x + 110, y: before.y + 30 },
      });
      await editor.settle();

      const after = editor.pointPosition(point.id);

      expect(editor.selection.has(point.id)).toBe(true);
      expect(after.x).toBeCloseTo(before.x + drag.delta.x);
      expect(after.y).toBeCloseTo(before.y + drag.delta.y);
    });

    it("drags the current selection from inside its bounding box", async () => {
      editor.selectTool("pen");
      editor.clickGlyphLocal(100, 100);
      await editor.settle();
      editor.clickGlyphLocal(200, 200);
      await editor.settle();

      const layer = editor.requireGlyphLayer();
      const [first, second] = layer.contours[0]?.points ?? [];
      if (!first || !second) throw new Error("Expected selected points");

      editor.selection.select([first.id, second.id]);
      editor.selectTool("select");

      const beforeFirst = editor.pointPosition(first.id);
      const beforeSecond = editor.pointPosition(second.id);
      const drag = editor.dragScene({
        down: { x: 120, y: 180 },
        start: { x: 124, y: 180 },
        end: { x: 150, y: 220 },
      });
      await editor.settle();

      const afterFirst = editor.pointPosition(first.id);
      const afterSecond = editor.pointPosition(second.id);

      expect(afterFirst.x).toBeCloseTo(beforeFirst.x + drag.delta.x);
      expect(afterFirst.y).toBeCloseTo(beforeFirst.y + drag.delta.y);
      expect(afterSecond.x).toBeCloseTo(beforeSecond.x + drag.delta.x);
      expect(afterSecond.y).toBeCloseTo(beforeSecond.y + drag.delta.y);
    });

    it("resizes the current selection from the pointer-down bounding-box handle", async () => {
      editor.selectTool("pen");
      editor.clickGlyphLocal(100, 100);
      await editor.settle();
      editor.clickGlyphLocal(200, 200);
      await editor.settle();

      const layer = editor.requireGlyphLayer();
      const [first, second] = layer.contours[0]?.points ?? [];
      if (!first || !second) throw new Error("Expected selected points");

      editor.selection.select([first.id, second.id]);
      editor.selectTool("select");

      const bounds = editor.selectionBounds();
      if (!bounds) throw new Error("Expected selection bounds");

      editor.dragScene({
        down: { x: bounds.right, y: bounds.bottom },
        start: { x: bounds.right + 60, y: bounds.bottom },
        end: { x: bounds.right + 50, y: bounds.bottom + 50 },
      });
      await editor.settle();

      const firstAfter = editor.pointPosition(first.id);
      const secondAfter = editor.pointPosition(second.id);

      expect(firstAfter.x).toBeCloseTo(100);
      expect(firstAfter.y).toBeCloseTo(100);
      expect(secondAfter.x).toBeCloseTo(250);
      expect(secondAfter.y).toBeCloseTo(250);
    });

    it("rotates the current selection from the pointer-down bounding-box zone", async () => {
      editor.selectTool("pen");
      editor.clickGlyphLocal(100, 100);
      await editor.settle();
      editor.clickGlyphLocal(200, 200);
      await editor.settle();

      const layer = editor.requireGlyphLayer();
      const [first, second] = layer.contours[0]?.points ?? [];
      if (!first || !second) throw new Error("Expected selected points");

      editor.selection.select([first.id, second.id]);
      editor.selectTool("select");

      const bounds = editor.selectionBounds();
      if (!bounds) throw new Error("Expected selection bounds");

      const offset = SELECT_BOUNDING_BOX_STYLE.rotationZoneOffsetPx;
      editor.dragScene({
        down: { x: bounds.right + offset, y: bounds.bottom + offset },
        start: { x: bounds.right + offset + 40, y: bounds.bottom + offset + 40 },
        end: { x: bounds.left - offset, y: bounds.bottom + offset },
      });
      await editor.settle();

      const firstAfter = editor.pointPosition(first.id);
      const secondAfter = editor.pointPosition(second.id);

      expect(firstAfter.x).toBeCloseTo(200);
      expect(firstAfter.y).toBeCloseTo(100);
      expect(secondAfter.x).toBeCloseTo(100);
      expect(secondAfter.y).toBeCloseTo(200);
    });

    it("drags a segment by its endpoints", async () => {
      editor.selectTool("pen");
      editor.clickGlyphLocal(100, 200);
      await editor.settle();
      editor.clickGlyphLocal(180, 200);
      await editor.settle();

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
      const drag = editor.dragScene({
        down: midpoint,
        start: { x: midpoint.x + 4, y: midpoint.y },
        end: { x: midpoint.x + 30, y: midpoint.y + 20 },
      });
      await editor.settle();

      const afterFirst = editor.pointPosition(first.id);
      const afterSecond = editor.pointPosition(second.id);

      expect(afterFirst.x).toBeCloseTo(beforeFirst.x + drag.delta.x);
      expect(afterFirst.y).toBeCloseTo(beforeFirst.y + drag.delta.y);
      expect(afterSecond.x).toBeCloseTo(beforeSecond.x + drag.delta.x);
      expect(afterSecond.y).toBeCloseTo(beforeSecond.y + drag.delta.y);
    });

    it("duplicates the current selection at the same position", async () => {
      editor.selectTool("pen");
      editor.clickGlyphLocal(100, 100);
      await editor.settle();
      editor.clickGlyphLocal(200, 100);
      await editor.settle();

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

    it("cuts the selected points to the clipboard", async () => {
      editor.selectTool("pen");
      editor.clickGlyphLocal(100, 100);
      await editor.settle();
      editor.clickGlyphLocal(200, 100);
      await editor.settle();

      const layer = editor.requireGlyphLayer();
      const pointIds = layer.allPoints.map((point) => point.id);
      editor.selection.select(pointIds);

      const cut = await editor.cut();
      await editor.settle();

      expect(cut).toBe(true);
      expect(layer.allPoints).toHaveLength(0);
      expect(editor.selection.hasSelection()).toBe(false);
      expect(editor.clipboardBuffer).toContain("shift/glyph-data");
    });

    it("upgrades a line segment to a cubic with alt-click", async () => {
      editor.selectTool("pen");
      editor.clickGlyphLocal(100, 200);
      await editor.settle();
      editor.clickGlyphLocal(190, 230);
      await editor.settle();

      const layer = editor.requireGlyphLayer();
      expect(layer.contours[0]?.segments()[0]?.type).toBe("line");

      editor.selectTool("select");
      editor.clickGlyphLocal(130, 210, { altKey: true });
      await editor.settle();

      expect(layer.contours[0]?.segments()[0]?.type).toBe("cubic");
      expect(layer.allPoints).toHaveLength(4);
    });

    it("bends a cubic segment with meta-drag", async () => {
      editor.selectTool("pen");
      editor.clickGlyphLocal(100, 200);
      await editor.settle();
      editor.clickGlyphLocal(190, 230);
      await editor.settle();

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
      editor.dragScene({
        down: bendPoint,
        start: { x: bendPoint.x + 4, y: bendPoint.y },
        end: { x: bendPoint.x + 4, y: bendPoint.y + 40 },
        options: { metaKey: true },
      });
      await editor.settle();

      const afterControlStart = editor.pointPosition(cubic.controlStart.id);
      const afterControlEnd = editor.pointPosition(cubic.controlEnd.id);

      expect(afterControlStart.y).toBeGreaterThan(beforeControlStart.y);
      expect(afterControlEnd.y).toBeGreaterThan(beforeControlEnd.y);
    });

    it("toggles a point smooth with double-click", async () => {
      editor.selectTool("pen");
      editor.clickGlyphLocal(100, 200);
      await editor.settle();

      const layer = editor.requireGlyphLayer();
      const point = layer.allPoints[0];
      if (!point) throw new Error("Expected point");

      editor.selectTool("select");
      editor.clickGlyphLocal(point.x, point.y);
      editor.clickGlyphLocal(point.x, point.y);
      await editor.settle();

      expect(layer.point(point.id)?.smooth).toBe(true);
    });

    it("marquee-selects points inside the brushed rectangle", async () => {
      editor.selectTool("pen");
      editor.clickGlyphLocal(100, 200);
      await editor.settle();
      editor.clickGlyphLocal(180, 200);
      await editor.settle();

      const layer = editor.requireGlyphLayer();
      const [inside, outside] = layer.contours[0]?.points ?? [];
      if (!inside || !outside) throw new Error("Expected line segment points");

      editor.selectTool("select");
      editor.dragScene({
        down: { x: 80, y: 180 },
        start: { x: 84, y: 180 },
        end: { x: 130, y: 230 },
      });

      expect(editor.selection.has(inside.id)).toBe(true);
      expect(editor.selection.has(outside.id)).toBe(false);
    });
  });
});
