import { describe, it, expect, beforeEach } from "vitest";
import { asPointId, mintGlyphId, mintNodeId, type GlyphName } from "@shift/types";
import { objectIsKindOf } from "@/types";
import { TestEditor } from "./TestEditor";

describe("TestEditor", () => {
  let editor: TestEditor;

  beforeEach(async () => {
    editor = new TestEditor();
    await editor.startSession();
  });

  describe("tool activation", () => {
    it("starts with the select tool activated", () => {
      expect(editor.toolIf("select")?.state).toEqual({ type: "ready" });
    });
  });

  describe("pointerMove", () => {
    it("flushes pointer input synchronously", () => {
      editor.selectTool("pen");

      // Two distinct moves must both register synchronously. Without the
      // explicit flush seam, these would be coalesced behind rAF and tests
      // would observe stale pointer input.
      editor.pointerMove(100, 100);
      const first = editor.input.pointer;

      editor.pointerMove(200, 200);
      const second = editor.input.pointer;

      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(second).not.toEqual(first);
    });
  });

  describe("settled user actions", () => {
    it("waits for glyph-local clicks before returning", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 200);
      const point = editor.openContour?.points[0];
      if (!point) throw new Error("Expected point");

      expect(editor.pointPosition(point.id)).toEqual({ x: 100, y: 200 });
    });

    it("rejects confirmed geometry reads while a raw action is pending", async () => {
      editor.selectTool("pen");
      const screen = editor.projectSceneToScreen({ x: 100, y: 200 });
      editor.pointerDown(screen.x, screen.y).pointerUp(screen.x, screen.y);
      const point = editor.openContour?.points[0];
      if (!point) throw new Error("Expected point");

      expect(() => editor.pointPosition(point.id)).toThrow("Workspace edits are pending");
      await editor.settle();
      expect(editor.pointPosition(point.id)).toEqual({ x: 100, y: 200 });
    });

    it("waits for editing key presses before returning", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 200);
      const point = editor.openContour?.points[0];
      if (!point) throw new Error("Expected point");
      editor.selection.select([point.id]);
      editor.selectTool("select");

      await editor.pressKey("ArrowRight");

      expect(editor.pointPosition(point.id)).toEqual({ x: 101, y: 200 });
    });
  });

  describe("glyph resolution", () => {
    it("distinguishes catalog records from acquired Glyphs", async () => {
      const record = editor.font.createGlyph("B" as GlyphName);
      await editor.settle();

      expect(editor.font.recordForId(record.id)).not.toBeNull();
      expect(editor.glyphForId(record.id)).toBeNull();

      const glyph = await editor.font.loadGlyph(record.id);

      expect(editor.glyphForId(record.id)).toBe(glyph);
      expect(editor.glyphForId(mintGlyphId())).toBeNull();
    });
  });

  describe("object resolution", () => {
    it("resolves placed scene nodes", () => {
      const node = editor.glyphNode;
      expect(node).not.toBeNull();
      if (!node) return;

      const object = editor.object(node.id);
      expect(objectIsKindOf(object, "node")).toBe(true);
      if (!objectIsKindOf(object, "node")) return;

      expect(object.id).toBe(node.id);
      expect(object.node).toEqual(node);
      expect(object.bounds()).toBeNull();
    });

    it("returns null for missing node ids", () => {
      expect(editor.object(mintNodeId())).toBeNull();
    });

    it("resolves placed glyph points", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 200);

      const layer = editor.glyphLayer;
      const node = editor.glyphNode;
      const point = editor.openContour?.points[0];
      if (!layer || !node || !point) throw new Error("Expected placed glyph point");

      const object = editor.object(point.id);
      expect(objectIsKindOf(object, "point")).toBe(true);
      if (!objectIsKindOf(object, "point")) return;

      expect(object.id).toBe(point.id);
      expect(object.pointId).toBe(point.id);
      expect(object.geometry.point(point.id)).toEqual(point);
      expect(editor.layerForGeometry({ points: [point.id] })?.id).toBe(layer.id);
      expect(object.node).toEqual(node);
      expect(object.bounds()).toEqual({
        x: 100,
        y: 200,
        width: 0,
        height: 0,
        left: 100,
        top: 200,
        right: 100,
        bottom: 200,
      });
    });

    it("resolves points added after ownership has already been queried", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 100);

      const layer = editor.requireGlyphLayer();
      const firstPoint = layer.allPoints[0];
      if (!firstPoint) throw new Error("Expected initial point");
      expect(editor.layerForGeometry({ points: [firstPoint.id] })?.id).toBe(layer.id);

      await editor.dragScene({
        down: { x: 300, y: 100 },
        threshold: { x: 320, y: 120 },
        end: { x: 380, y: 180 },
      });

      const pointIds = editor.openContour?.points.map((point) => point.id) ?? [];
      expect(editor.openContour?.segments()[0]?.type).toBe("cubic");
      expect(editor.layerForGeometry({ points: pointIds })?.id).toBe(layer.id);
    });

    it("resolves placed glyph segments and contours", async () => {
      editor.selectTool("pen");
      await editor.clickGlyphLocal(100, 200);
      await editor.clickGlyphLocal(180, 200);

      const layer = editor.glyphLayer;
      const node = editor.glyphNode;
      const contour = editor.openContour;
      const segment = contour?.segments()[0];
      if (!layer || !node || !contour || !segment) {
        throw new Error("Expected placed glyph segment and contour");
      }

      const segmentObject = editor.object(segment.id);
      expect(objectIsKindOf(segmentObject, "segment")).toBe(true);
      if (!objectIsKindOf(segmentObject, "segment")) return;

      expect(segmentObject.id).toBe(segment.id);
      expect(segmentObject.segmentId).toBe(segment.id);
      expect(segmentObject.pointIds).toEqual(segment.pointIds);
      expect(segmentObject.geometry.segment(segment.id)).toEqual(segment);
      expect(editor.layerForGeometry({ segments: [segment.id] })?.id).toBe(layer.id);
      expect(segmentObject.node).toEqual(node);

      const contourObject = editor.object(contour.id);
      expect(objectIsKindOf(contourObject, "contour")).toBe(true);
      if (!objectIsKindOf(contourObject, "contour")) return;

      expect(contourObject.id).toBe(contour.id);
      expect(contourObject.contourId).toBe(contour.id);
      expect(contourObject.geometry.contour(contour.id)).toEqual(contour);
      expect(editor.layerForGeometry({ contours: [contour.id] })?.id).toBe(layer.id);
      expect(contourObject.node).toEqual(node);
    });

    it("returns null for glyph-internal ids without a placed editable node", () => {
      expect(editor.object(asPointId("point_missing"))).toBeNull();
    });
  });
});
