import { beforeEach, describe, expect, it } from "vitest";
import type { Point2D } from "@shift/geo";
import type { PointId } from "@shift/types";
import type { GlyphLayer } from "@/lib/model/Glyph";
import { TestEditor } from "@/testing/TestEditor";
import { SELECT_BOUNDING_BOX_STYLE } from "./BoundingBox";

describe("Select bounding-box transforms preserve geometry outcomes", () => {
  let editor: TestEditor;
  let layer: GlyphLayer;
  let firstId: PointId;
  let secondId: PointId;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    [firstId, secondId] = await editor.drawOpenContour([
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ]);
    layer = editor.requireGlyphLayer();
    editor.selection.select([firstId, secondId]);
    editor.selectTool("select");
  });

  describe("resizing", () => {
    it("changes only X when dragging the right edge", async () => {
      const bounds = editor.selectionBounds();
      if (!bounds) throw new Error("Expected selection bounds");

      await editor.dragScene({
        down: { x: bounds.right, y: (bounds.top + bounds.bottom) / 2 },
        start: { x: bounds.right + 4, y: (bounds.top + bounds.bottom) / 2 },
        end: { x: bounds.right + 50, y: (bounds.top + bounds.bottom) / 2 },
      });

      expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 250, y: 200 });
    });

    it("changes only Y when dragging the bottom edge", async () => {
      const bounds = editor.selectionBounds();
      if (!bounds) throw new Error("Expected selection bounds");

      await editor.dragScene({
        down: { x: (bounds.left + bounds.right) / 2, y: bounds.bottom },
        start: { x: (bounds.left + bounds.right) / 2, y: bounds.bottom + 4 },
        end: { x: (bounds.left + bounds.right) / 2, y: bounds.bottom + 50 },
      });

      expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 200, y: 250 });
    });

    it("resizes both axes from a corner", async () => {
      const bounds = editor.selectionBounds();
      if (!bounds) throw new Error("Expected selection bounds");

      await editor.dragScene({
        down: { x: bounds.right, y: bounds.bottom },
        start: { x: bounds.right + 4, y: bounds.bottom + 4 },
        end: { x: bounds.right + 50, y: bounds.bottom + 25 },
      });

      expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 250, y: 225 });
    });

    it("uses one scale on both axes for a Shift-corner resize", async () => {
      const bounds = editor.selectionBounds();
      if (!bounds) throw new Error("Expected selection bounds");

      await editor.dragScene({
        down: { x: bounds.right, y: bounds.bottom },
        start: { x: bounds.right + 4, y: bounds.bottom + 4 },
        end: { x: bounds.right + 100, y: bounds.bottom + 50 },
        options: { shiftKey: true },
      });

      expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 300, y: 300 });
    });

    it("flips geometry after the dragged edge crosses the fixed edge", async () => {
      const bounds = editor.selectionBounds();
      if (!bounds) throw new Error("Expected selection bounds");
      const centerY = (bounds.top + bounds.bottom) / 2;

      await editor.dragScene({
        down: { x: bounds.right, y: centerY },
        start: { x: bounds.right + 4, y: centerY },
        end: { x: 50, y: centerY },
      });

      expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 50, y: 200 });
    });

    it("restores original positions when Escape cancels resize", () => {
      const bounds = editor.selectionBounds();
      if (!bounds) throw new Error("Expected selection bounds");
      const down = editor.projectSceneToScreen({ x: bounds.right, y: bounds.bottom });
      const start = editor.projectSceneToScreen({ x: bounds.right + 4, y: bounds.bottom + 4 });
      const end = editor.projectSceneToScreen({ x: bounds.right + 50, y: bounds.bottom + 50 });

      editor.pointerDown(down.x, down.y).pointerMove(start.x, start.y).pointerMove(end.x, end.y);
      expect(editor.pointPosition(secondId)).not.toEqual({ x: 200, y: 200 });
      editor.escape();

      expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 200, y: 200 });
    });

    it("commits resize as one undoable and redoable edit", async () => {
      const bounds = editor.selectionBounds();
      if (!bounds) throw new Error("Expected selection bounds");
      await editor.dragScene({
        down: { x: bounds.right, y: bounds.bottom },
        start: { x: bounds.right + 4, y: bounds.bottom + 4 },
        end: { x: bounds.right + 50, y: bounds.bottom + 50 },
      });
      const resized = editor.pointPosition(secondId);

      await editor.undo();
      expect(editor.pointPosition(secondId)).toEqual({ x: 200, y: 200 });
      await editor.redo();
      expect(editor.pointPosition(secondId)).toEqual(resized);
    });
  });

  describe("rotation", () => {
    async function rotateAcrossBottomEdge(): Promise<void> {
      const bounds = editor.selectionBounds();
      if (!bounds) throw new Error("Expected selection bounds");
      const offset = SELECT_BOUNDING_BOX_STYLE.rotationZoneOffsetPx;

      await editor.dragScene({
        down: { x: bounds.right + offset, y: bounds.bottom + offset },
        start: { x: bounds.right + offset + 4, y: bounds.bottom + offset + 4 },
        end: { x: bounds.left - offset, y: bounds.bottom + offset },
      });
    }

    it("rotates around the center of the selection", async () => {
      await rotateAcrossBottomEdge();

      expect(editor.pointPosition(firstId).x).toBeCloseTo(200);
      expect(editor.pointPosition(firstId).y).toBeCloseTo(100);
      expect(editor.pointPosition(secondId).x).toBeCloseTo(100);
      expect(editor.pointPosition(secondId).y).toBeCloseTo(200);
    });

    it("uses glyph-local geometry when the scene node has a non-zero position", async () => {
      const node = editor.glyphNode;
      if (!node) throw new Error("Expected glyph node");
      editor.scene.updateNode({ id: node.id, position: { x: 400, y: 300 } });

      await rotateAcrossBottomEdge();

      expect(editor.pointPosition(firstId).x).toBeCloseTo(200);
      expect(editor.pointPosition(firstId).y).toBeCloseTo(100);
      expect(editor.pointPosition(secondId).x).toBeCloseTo(100);
      expect(editor.pointPosition(secondId).y).toBeCloseTo(200);
    });

    it("restores original positions when Escape cancels rotation", () => {
      const bounds = editor.selectionBounds();
      if (!bounds) throw new Error("Expected selection bounds");
      const offset = SELECT_BOUNDING_BOX_STYLE.rotationZoneOffsetPx;
      const down = editor.projectSceneToScreen({
        x: bounds.right + offset,
        y: bounds.bottom + offset,
      });
      const start = editor.projectSceneToScreen({
        x: bounds.right + offset + 4,
        y: bounds.bottom + offset + 4,
      });
      const end = editor.projectSceneToScreen({
        x: bounds.left - offset,
        y: bounds.bottom + offset,
      });

      editor.pointerDown(down.x, down.y).pointerMove(start.x, start.y).pointerMove(end.x, end.y);
      expect(editor.pointPosition(firstId)).not.toEqual({ x: 100, y: 100 });
      editor.escape();

      expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 200, y: 200 });
    });

    it("commits rotation as one undoable and redoable edit", async () => {
      await rotateAcrossBottomEdge();
      const rotated = [editor.pointPosition(firstId), editor.pointPosition(secondId)];

      await editor.undo();
      expect([editor.pointPosition(firstId), editor.pointPosition(secondId)]).toEqual([
        { x: 100, y: 100 },
        { x: 200, y: 200 },
      ]);

      await editor.redo();
      expect([editor.pointPosition(firstId), editor.pointPosition(secondId)]).toEqual(rotated);
    });

    it("rotates selected points and anchors with the same transform", async () => {
      const anchorId = layer.addAnchor("mark", { x: 125, y: 125 });
      await editor.settle();
      editor.selection.select([firstId, secondId, anchorId]);

      await rotateAcrossBottomEdge();
      const first = editor.pointPosition(firstId);
      const second = editor.pointPosition(secondId);

      expect(editor.anchorPosition(anchorId).x).toBeCloseTo(first.x + (second.x - first.x) * 0.25);
      expect(editor.anchorPosition(anchorId).y).toBeCloseTo(first.y + (second.y - first.y) * 0.25);
    });
  });
});

describe("Select curve bending preserves edit lifecycle", () => {
  let editor: TestEditor;
  let layer: GlyphLayer;
  let controlOneId: PointId;
  let controlTwoId: PointId;
  let bendPoint: Point2D;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
    await editor.drawOpenContour([
      { x: 100, y: 200 },
      { x: 200, y: 200 },
    ]);
    layer = editor.requireGlyphLayer();
    const segment = layer.contours[0]?.segments()[0];
    if (!segment || !layer.upgradeLineToCubic(segment.id)) throw new Error("Expected cubic");
    await editor.settle();
    const cubicSegment = layer.contours[0]?.segments()[0];
    const cubic = cubicSegment?.asCubic();
    if (!cubicSegment || !cubic) throw new Error("Expected cubic");
    controlOneId = cubic.controlStart.id;
    controlTwoId = cubic.controlEnd.id;
    bendPoint = cubicSegment.pointAt(0.5);
    editor.selectTool("select");
  });

  it("restores both controls when Escape cancels bending", () => {
    const oneBefore = editor.pointPosition(controlOneId);
    const twoBefore = editor.pointPosition(controlTwoId);
    const down = editor.projectSceneToScreen(bendPoint);
    const start = editor.projectSceneToScreen({ x: bendPoint.x + 4, y: bendPoint.y });
    const end = editor.projectSceneToScreen({ x: bendPoint.x + 4, y: bendPoint.y + 40 });

    editor.pointerDown(down.x, down.y, { metaKey: true });
    editor.pointerMove(start.x, start.y, { metaKey: true });
    editor.pointerMove(end.x, end.y, { metaKey: true });
    expect(editor.pointPosition(controlOneId)).not.toEqual(oneBefore);
    editor.escape();

    expect(editor.pointPosition(controlOneId)).toEqual(oneBefore);
    expect(editor.pointPosition(controlTwoId)).toEqual(twoBefore);
  });

  it("commits bending as one undoable and redoable edit", async () => {
    const oneBefore = editor.pointPosition(controlOneId);
    const twoBefore = editor.pointPosition(controlTwoId);
    await editor.dragScene({
      down: bendPoint,
      start: { x: bendPoint.x + 4, y: bendPoint.y },
      end: { x: bendPoint.x + 4, y: bendPoint.y + 40 },
      options: { metaKey: true },
    });
    const bent = [editor.pointPosition(controlOneId), editor.pointPosition(controlTwoId)];

    await editor.undo();
    expect([editor.pointPosition(controlOneId), editor.pointPosition(controlTwoId)]).toEqual([
      oneBefore,
      twoBefore,
    ]);

    await editor.redo();
    expect([editor.pointPosition(controlOneId), editor.pointPosition(controlTwoId)]).toEqual(bent);
  });
});
