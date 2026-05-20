import { describe, it, expect } from "vitest";
import { Bounds, type Point2D, type Rect2D } from "@shift/geo";
import type { Editor } from "@/lib/editor/Editor";
import { signal } from "@/lib/signals";
import { SELECT_BOUNDING_BOX_STYLE, SelectBoundingBox } from "./BoundingBox";
import type { Select } from "./Select";

const createRect = (
  x: number,
  y: number,
  width: number,
  height: number,
): Rect2D => ({
  x,
  y,
  width,
  height,
  left: x,
  top: y,
  right: x + width,
  bottom: y + height,
});

function createBoundingBox(rect: Rect2D) {
  const project = (glyphLocal: Point2D) => ({
    screen: { x: glyphLocal.x, y: -glyphLocal.y },
    scene: glyphLocal,
    glyphLocal,
  });
  const editor = {
    selection: {
      bounds: Bounds.fromXYWH(rect.x, rect.y, rect.width, rect.height),
      boundsCell: signal(
        Bounds.fromXYWH(rect.x, rect.y, rect.width, rect.height),
      ),
      stateCell: signal({
        pointIds: new Set(["p1", "p2"]),
        anchorIds: new Set(),
        segmentIds: new Set(),
      }),
      hasSelection: () => true,
    },
    camera: {
      trackViewportTransform: () => {},
    },
    glyphDisplayCell: signal({
      proofMode: false,
      handlesVisible: true,
      editableGlyphVisible: true,
    }),
    fromGlyphLocal: project,
    screenToUpmDistance: (pixels: number) => pixels,
  } as unknown as Editor;
  const select = {
    editor,
    stateCell: signal({ type: "ready" }),
  } as unknown as Select;

  const boundingBox = new SelectBoundingBox(select);

  return (glyphLocal: Point2D) => boundingBox.hit(project(glyphLocal));
}

describe("SelectBoundingBox.hit", () => {
  const rect = createRect(100, 100, 200, 100);
  const hit = createBoundingBox(rect);
  const handleOffset = SELECT_BOUNDING_BOX_STYLE.handle.offsetPx;
  const rotationZoneOffset = SELECT_BOUNDING_BOX_STYLE.rotationZoneOffsetPx;

  describe("resize corner handles", () => {
    it("detects top-left resize handle", () => {
      expect(
        hit({ x: 100 - handleOffset, y: 200 + handleOffset }),
      ).toMatchObject({
        type: "resize",
        edge: "top-left",
      });
    });

    it("detects top-right resize handle", () => {
      expect(
        hit({ x: 300 + handleOffset, y: 200 + handleOffset }),
      ).toMatchObject({
        type: "resize",
        edge: "top-right",
      });
    });

    it("detects bottom-left resize handle", () => {
      expect(
        hit({ x: 100 - handleOffset, y: 100 - handleOffset }),
      ).toMatchObject({
        type: "resize",
        edge: "bottom-left",
      });
    });

    it("detects bottom-right resize handle", () => {
      expect(
        hit({ x: 300 + handleOffset, y: 100 - handleOffset }),
      ).toMatchObject({
        type: "resize",
        edge: "bottom-right",
      });
    });
  });

  describe("resize edges", () => {
    it("detects the top resize edge away from handles", () => {
      expect(hit({ x: 150, y: 200 + handleOffset })).toMatchObject({
        type: "resize",
        edge: "top",
      });
    });

    it("detects the bottom resize edge away from handles", () => {
      expect(hit({ x: 250, y: 100 - handleOffset })).toMatchObject({
        type: "resize",
        edge: "bottom",
      });
    });

    it("detects the left resize edge away from handles", () => {
      expect(hit({ x: 100 - handleOffset, y: 140 })).toMatchObject({
        type: "resize",
        edge: "left",
      });
    });

    it("detects the right resize edge away from handles", () => {
      expect(hit({ x: 300 + handleOffset, y: 160 })).toMatchObject({
        type: "resize",
        edge: "right",
      });
    });
  });

  describe("rotation zones", () => {
    it("detects top-left rotation zone", () => {
      expect(
        hit({ x: 100 - rotationZoneOffset, y: 200 + rotationZoneOffset }),
      ).toMatchObject({
        type: "rotate",
        corner: "top-left",
      });
    });

    it("detects top-right rotation zone", () => {
      expect(
        hit({ x: 300 + rotationZoneOffset, y: 200 + rotationZoneOffset }),
      ).toMatchObject({
        type: "rotate",
        corner: "top-right",
      });
    });

    it("detects bottom-left rotation zone", () => {
      expect(
        hit({ x: 100 - rotationZoneOffset, y: 100 - rotationZoneOffset }),
      ).toMatchObject({
        type: "rotate",
        corner: "bottom-left",
      });
    });

    it("detects bottom-right rotation zone", () => {
      expect(
        hit({ x: 300 + rotationZoneOffset, y: 100 - rotationZoneOffset }),
      ).toMatchObject({
        type: "rotate",
        corner: "bottom-right",
      });
    });
  });

  describe("no hit", () => {
    it("returns null when clicking inside the bounding box", () => {
      expect(hit({ x: 200, y: 150 })).toBeNull();
    });

    it("returns null when clicking far outside the bounding box", () => {
      expect(hit({ x: 500, y: 500 })).toBeNull();
    });
  });
});
