import { describe, it, expect, beforeEach } from "vitest";
import { asPointId, mintNodeId } from "@shift/types";
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
      expect(editor.getActiveTool()).toBe("select");
      expect(editor.toolManager.activeToolId).toBe("select");
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
      editor.clickGlyphLocal(100, 200);
      await editor.settle();

      const layer = editor.glyphLayer;
      const node = editor.glyphNode;
      const point = editor.openContour?.points[0];
      if (!layer || !node || !point) throw new Error("Expected placed glyph point");

      const object = editor.object(point.id);
      expect(objectIsKindOf(object, "point")).toBe(true);
      if (!objectIsKindOf(object, "point")) return;

      expect(object.id).toBe(point.id);
      expect(object.pointId).toBe(point.id);
      expect(object.layer.id).toBe(layer.id);
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

    it("resolves placed glyph segments and contours", async () => {
      editor.selectTool("pen");
      editor.clickGlyphLocal(100, 200);
      await editor.settle();
      editor.clickGlyphLocal(180, 200);
      await editor.settle();

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
      expect(segmentObject.layer.id).toBe(layer.id);
      expect(segmentObject.node).toEqual(node);

      const contourObject = editor.object(contour.id);
      expect(objectIsKindOf(contourObject, "contour")).toBe(true);
      if (!objectIsKindOf(contourObject, "contour")) return;

      expect(contourObject.id).toBe(contour.id);
      expect(contourObject.contourId).toBe(contour.id);
      expect(contourObject.layer.id).toBe(layer.id);
      expect(contourObject.node).toEqual(node);
    });

    it("returns null for glyph-internal ids without a placed editable node", () => {
      expect(editor.object(asPointId("point_missing"))).toBeNull();
    });
  });
});
