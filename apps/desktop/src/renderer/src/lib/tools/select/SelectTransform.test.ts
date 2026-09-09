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

  it("offers moving on a straight segment inside the selection without Cmd", () => {
    const down = editor.projectSceneToScreen({ x: 150, y: 150 });
    editor.pointerMove(down.x, down.y);

    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "move" });
  });

  it("offers upgrading on Cmd-hover over a straight segment inside the selection", () => {
    const down = editor.projectSceneToScreen({ x: 150, y: 150 });
    editor.pointerMove(down.x, down.y, { metaKey: true });

    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "bend" });
    expect(layer.contours[0].segments()[0].type).toBe("line");
    expect(editor.selection.ids).toEqual([firstId, secondId]);
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

    it("uses layer-local geometry when the scene node has a non-zero position", async () => {
      const node = editor.glyphNode;
      if (!node) throw new Error("Expected glyph node");
      editor.scene.updateNode({ id: node.id, position: { x: 400, y: 300 } });
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

  describe.each([false, true])("resize handle geometry with Alt held: %s", (altKey) => {
    it.each([
      {
        handle: "left",
        down: { x: 100, y: 150 },
        end: { x: 50, y: 150 },
        normal: [
          { x: 50, y: 100 },
          { x: 200, y: 200 },
        ],
        centered: [
          { x: 50, y: 100 },
          { x: 250, y: 200 },
        ],
      },
      {
        handle: "right",
        down: { x: 200, y: 150 },
        end: { x: 250, y: 150 },
        normal: [
          { x: 100, y: 100 },
          { x: 250, y: 200 },
        ],
        centered: [
          { x: 50, y: 100 },
          { x: 250, y: 200 },
        ],
      },
      {
        handle: "top",
        down: { x: 150, y: 200 },
        end: { x: 150, y: 250 },
        normal: [
          { x: 100, y: 100 },
          { x: 200, y: 250 },
        ],
        centered: [
          { x: 100, y: 50 },
          { x: 200, y: 250 },
        ],
      },
      {
        handle: "bottom",
        down: { x: 150, y: 100 },
        end: { x: 150, y: 50 },
        normal: [
          { x: 100, y: 50 },
          { x: 200, y: 200 },
        ],
        centered: [
          { x: 100, y: 50 },
          { x: 200, y: 250 },
        ],
      },
      {
        handle: "top-left",
        down: { x: 100, y: 200 },
        end: { x: 50, y: 250 },
        normal: [
          { x: 50, y: 100 },
          { x: 200, y: 250 },
        ],
        centered: [
          { x: 50, y: 50 },
          { x: 250, y: 250 },
        ],
      },
      {
        handle: "top-right",
        down: { x: 200, y: 200 },
        end: { x: 250, y: 250 },
        normal: [
          { x: 100, y: 100 },
          { x: 250, y: 250 },
        ],
        centered: [
          { x: 50, y: 50 },
          { x: 250, y: 250 },
        ],
      },
      {
        handle: "bottom-left",
        down: { x: 100, y: 100 },
        end: { x: 50, y: 50 },
        normal: [
          { x: 50, y: 50 },
          { x: 200, y: 200 },
        ],
        centered: [
          { x: 50, y: 50 },
          { x: 250, y: 250 },
        ],
      },
      {
        handle: "bottom-right",
        down: { x: 200, y: 100 },
        end: { x: 250, y: 50 },
        normal: [
          { x: 100, y: 50 },
          { x: 250, y: 200 },
        ],
        centered: [
          { x: 50, y: 50 },
          { x: 250, y: 250 },
        ],
      },
    ])("keeps the $handle handle under the pointer", async ({ down, end, normal, centered }) => {
      await editor.dragScene({ down, start: end, end, options: { altKey } });

      expect([editor.pointPosition(firstId), editor.pointPosition(secondId)]).toEqual(
        altKey ? centered : normal,
      );
    });
  });

  describe("resize modifiers follow drag samples", () => {
    it.each([true, false])("switches Alt to %s using the original geometry", (altKey) => {
      const down = editor.projectSceneToScreen({ x: 200, y: 150 });
      const first = editor.projectSceneToScreen({ x: 225, y: 150 });
      const second = editor.projectSceneToScreen({ x: 250, y: 150 });

      editor.pointerDown(down.x, down.y, { altKey: !altKey });
      editor.pointerMove(first.x, first.y, { altKey: !altKey });
      editor.pointerMove(second.x, second.y, { altKey });
      expect(editor.pointPosition(firstId)).toEqual({ x: altKey ? 50 : 100, y: 100 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 250, y: 200 });
      editor.escape();
      expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 200, y: 200 });
    });

    it.each([true, false])(
      "commits the release position with the last drag Alt value of %s",
      async (altKey) => {
        const down = editor.projectSceneToScreen({ x: 200, y: 150 });
        const move = editor.projectSceneToScreen({ x: 240, y: 150 });
        const end = editor.projectSceneToScreen({ x: 250, y: 150 });

        editor.pointerDown(down.x, down.y, { altKey: !altKey });
        editor.pointerMove(move.x, move.y, { altKey });
        editor.pointerUp(end.x, end.y, { altKey: !altKey });
        await editor.settle();
        expect(editor.pointPosition(firstId)).toEqual({ x: altKey ? 50 : 100, y: 100 });
        expect(editor.pointPosition(secondId)).toEqual({ x: 250, y: 200 });
      },
    );

    it("switches Alt during a Shift resize and keeps one undoable edit", async () => {
      const down = editor.projectSceneToScreen({ x: 200, y: 200 });
      const move = editor.projectSceneToScreen({ x: 210, y: 205 });
      const end = editor.projectSceneToScreen({ x: 250, y: 225 });

      editor.pointerDown(down.x, down.y).pointerMove(move.x, move.y, { shiftKey: true });
      editor.pointerMove(end.x, end.y, { altKey: true, shiftKey: true }).pointerUp(end.x, end.y);
      await editor.settle();
      expect(editor.pointPosition(firstId)).toEqual({ x: 50, y: 50 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 250, y: 250 });
      await editor.undo();
      expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 200, y: 200 });
      await editor.redo();
      expect(editor.pointPosition(firstId)).toEqual({ x: 50, y: 50 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 250, y: 250 });
    });

    it("switches pivots in glyph-local coordinates when the scene node is translated", async () => {
      const node = editor.glyphNode;
      if (!node) throw new Error("Expected glyph node");
      editor.scene.updateNode({ id: node.id, position: { x: 400, y: 300 } });
      const down = editor.projectSceneToScreen({ x: 600, y: 450 });
      const move = editor.projectSceneToScreen({ x: 625, y: 450 });
      const end = editor.projectSceneToScreen({ x: 650, y: 450 });

      editor.pointerDown(down.x, down.y).pointerMove(move.x, move.y);
      editor.pointerMove(end.x, end.y, { altKey: true }).pointerUp(end.x, end.y);
      await editor.settle();
      expect(editor.pointPosition(firstId)).toEqual({ x: 50, y: 100 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 250, y: 200 });
    });
  });

  describe("centred resizing preserves preview and edit behavior", () => {
    it("does not halve the shape on its first preview and cancels to the original positions", () => {
      const down = editor.projectSceneToScreen({ x: 200, y: 150 });
      const move = editor.projectSceneToScreen({ x: 210, y: 150 });

      editor
        .pointerDown(down.x, down.y, { altKey: true })
        .pointerMove(move.x, move.y, { altKey: true });
      expect(editor.pointPosition(firstId)).toEqual({ x: 90, y: 100 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 210, y: 200 });
      editor.escape();
      expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 200, y: 200 });
    });

    it("combines Alt with Shift and records one undoable resize", async () => {
      await editor.dragScene({
        down: { x: 200, y: 200 },
        start: { x: 210, y: 205 },
        end: { x: 250, y: 225 },
        options: { altKey: true, shiftKey: true },
      });
      expect(editor.pointPosition(firstId)).toEqual({ x: 50, y: 50 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 250, y: 250 });
      await editor.undo();
      expect(editor.pointPosition(firstId)).toEqual({ x: 100, y: 100 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 200, y: 200 });
      await editor.redo();
      expect(editor.pointPosition(firstId)).toEqual({ x: 50, y: 50 });
      expect(editor.pointPosition(secondId)).toEqual({ x: 250, y: 250 });
    });
  });

  describe.each([false, true])("resize cursors follow mirrored geometry with Alt: %s", (altKey) => {
    it.each([
      {
        corner: "top-left",
        down: { x: 100, y: 200 },
        normal: { x: 75, y: 225 },
        acrossX: { x: 250, y: 225 },
        acrossY: { x: 75, y: 50 },
        acrossBoth: { x: 250, y: 50 },
        cursor: "nwse-resize",
        flippedCursor: "nesw-resize",
      },
      {
        corner: "top-right",
        down: { x: 200, y: 200 },
        normal: { x: 225, y: 225 },
        acrossX: { x: 50, y: 225 },
        acrossY: { x: 225, y: 50 },
        acrossBoth: { x: 50, y: 50 },
        cursor: "nesw-resize",
        flippedCursor: "nwse-resize",
      },
      {
        corner: "bottom-left",
        down: { x: 100, y: 100 },
        normal: { x: 75, y: 75 },
        acrossX: { x: 250, y: 75 },
        acrossY: { x: 75, y: 250 },
        acrossBoth: { x: 250, y: 250 },
        cursor: "nesw-resize",
        flippedCursor: "nwse-resize",
      },
      {
        corner: "bottom-right",
        down: { x: 200, y: 100 },
        normal: { x: 225, y: 75 },
        acrossX: { x: 50, y: 75 },
        acrossY: { x: 225, y: 250 },
        acrossBoth: { x: 50, y: 250 },
        cursor: "nwse-resize",
        flippedCursor: "nesw-resize",
      },
    ])(
      "updates the $corner cursor when crossing either pivot axis and returning",
      ({ down, normal, acrossX, acrossY, acrossBoth, cursor, flippedCursor }) => {
        const start = editor.projectSceneToScreen(down);
        const move = editor.projectSceneToScreen(normal);
        editor.pointerDown(start.x, start.y, { altKey }).pointerMove(move.x, move.y, { altKey });
        const positions = [editor.pointPosition(firstId), editor.pointPosition(secondId)];

        for (const sample of [
          { position: normal, cursor },
          { position: acrossX, cursor: flippedCursor },
          { position: acrossBoth, cursor },
          { position: acrossY, cursor: flippedCursor },
          { position: normal, cursor },
        ]) {
          const point = editor.projectSceneToScreen(sample.position);
          editor.pointerMove(point.x, point.y, { altKey });
          expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: sample.cursor });
        }
        expect([editor.pointPosition(firstId), editor.pointPosition(secondId)]).toEqual(positions);
        editor.escape();
      },
    );

    it.each([
      { edge: "left", down: { x: 100, y: 150 }, end: { x: 250, y: 150 }, cursor: "ew-resize" },
      { edge: "right", down: { x: 200, y: 150 }, end: { x: 50, y: 150 }, cursor: "ew-resize" },
      { edge: "top", down: { x: 150, y: 200 }, end: { x: 150, y: 50 }, cursor: "ns-resize" },
      { edge: "bottom", down: { x: 150, y: 100 }, end: { x: 150, y: 250 }, cursor: "ns-resize" },
    ])("keeps the $edge cursor on its axis after flipping", ({ down, end, cursor }) => {
      const start = editor.projectSceneToScreen(down);
      const move = editor.projectSceneToScreen(end);
      editor.pointerDown(start.x, start.y, { altKey }).pointerMove(move.x, move.y, { altKey });

      expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: cursor });
      editor.escape();
    });

    it("restores the original diagonal at zero scale and starts the next drag unflipped", () => {
      const down = editor.projectSceneToScreen({ x: 200, y: 200 });
      const crossed = editor.projectSceneToScreen({ x: 50, y: 200 });
      const pivot = editor.projectSceneToScreen({ x: altKey ? 150 : 100, y: 200 });
      editor.pointerDown(down.x, down.y, { altKey }).pointerMove(crossed.x, crossed.y, { altKey });
      expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "nwse-resize" });
      editor.pointerMove(pivot.x, pivot.y, { altKey });
      expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "nesw-resize" });
      editor.escape();
      const next = editor.projectSceneToScreen({ x: 225, y: 225 });
      editor.pointerDown(down.x, down.y).pointerMove(next.x, next.y);
      expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "nesw-resize" });
      editor.escape();
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

  it("shows the bend cursor when Meta is pressed over a cubic, and clears it on release", () => {
    const down = editor.projectSceneToScreen(bendPoint);
    editor.pointerMove(down.x, down.y);
    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "default" });

    editor.keyDown("Meta", { metaKey: true });
    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "bend" });

    editor.pointerMove(down.x, down.y);
    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "default" });
  });

  it("keeps the normal cursor when Alt is pressed over a segment", () => {
    const down = editor.projectSceneToScreen(bendPoint);
    editor.pointerMove(down.x, down.y);
    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "default" });

    editor.keyDown("Alt", { altKey: true });
    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "default" });
  });

  it("does not offer bending on a point or empty canvas", () => {
    const down = editor.projectSceneToScreen({ x: 100, y: 200 });
    editor.pointerMove(down.x, down.y, { metaKey: true });
    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "default" });

    editor.pointerMove(down.x + 300, down.y + 300, { metaKey: true });
    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "default" });
  });

  it("keeps the bend cursor during a drag even after Meta is released", async () => {
    const down = editor.projectSceneToScreen(bendPoint);
    editor.pointerDown(down.x, down.y, { metaKey: true });
    editor.pointerMove(down.x + 4, down.y, { metaKey: true });
    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "bend" });

    editor.pointerMove(down.x + 4, down.y + 40);
    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "bend" });
    editor.pointerUp(down.x + 4, down.y + 40);
    await editor.settle();
    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "default" });
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
    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "bend" });
    editor.escape();

    expect(editor.toolManager.activeTool?.cursorCell.value).toEqual({ type: "default" });
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
