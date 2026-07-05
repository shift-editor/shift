import { describe, it, expect } from "vitest";
import { type Point2D, type Rect2D } from "@shift/geo";
import { asPointId } from "@shift/types";
import type { Editor } from "@/lib/editor/Editor";
import { signal } from "@/lib/signals";
import { SELECT_BOUNDING_BOX_STYLE, SelectBoundingBox } from "./BoundingBox";
import type { Select } from "./Select";

const createRect = (x: number, y: number, width: number, height: number): Rect2D => ({
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
  const projectSceneToScreen = (scene: Point2D) => ({ x: scene.x, y: -scene.y });
  const editor = {
    selection: {
      stateCell: signal({
        ids: [asPointId("point_a"), asPointId("point_b")],
      }),
    },
    selectionBoundsCell: signal(rect),
    camera: {
      trackViewportTransform: () => {},
    },
    projectSceneToScreen,
    screenToUpmDistance: (pixels: number) => pixels,
  } as unknown as Editor;
  const select = {
    editor,
    stateCell: signal({ type: "ready" }),
  } as unknown as Select;

  const boundingBox = new SelectBoundingBox(select);

  return (scene: Point2D) =>
    boundingBox.hit({
      screen: projectSceneToScreen(scene),
      scene,
    });
}

describe("SelectBoundingBox.hit", () => {
  const rect = createRect(100, 100, 200, 100);
  const hit = createBoundingBox(rect);
  const handleOffset = SELECT_BOUNDING_BOX_STYLE.handle.offsetPx;
  const rotationZoneOffset = SELECT_BOUNDING_BOX_STYLE.rotationZoneOffsetPx;

  describe("resize corner handles", () => {
    it("detects top-left resize handle", () => {
      expect(hit({ x: 100 - handleOffset, y: 200 + handleOffset })).toMatchObject({
        type: "resize",
        edge: "top-left",
      });
    });

    it("detects top-right resize handle", () => {
      expect(hit({ x: 300 + handleOffset, y: 200 + handleOffset })).toMatchObject({
        type: "resize",
        edge: "top-right",
      });
    });

    it("detects bottom-left resize handle", () => {
      expect(hit({ x: 100 - handleOffset, y: 100 - handleOffset })).toMatchObject({
        type: "resize",
        edge: "bottom-left",
      });
    });

    it("detects bottom-right resize handle", () => {
      expect(hit({ x: 300 + handleOffset, y: 100 - handleOffset })).toMatchObject({
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
      expect(hit({ x: 100 - rotationZoneOffset, y: 200 + rotationZoneOffset })).toMatchObject({
        type: "rotate",
        corner: "top-left",
      });
    });

    it("detects top-right rotation zone", () => {
      expect(hit({ x: 300 + rotationZoneOffset, y: 200 + rotationZoneOffset })).toMatchObject({
        type: "rotate",
        corner: "top-right",
      });
    });

    it("detects bottom-left rotation zone", () => {
      expect(hit({ x: 100 - rotationZoneOffset, y: 100 - rotationZoneOffset })).toMatchObject({
        type: "rotate",
        corner: "bottom-left",
      });
    });

    it("detects bottom-right rotation zone", () => {
      expect(hit({ x: 300 + rotationZoneOffset, y: 100 - rotationZoneOffset })).toMatchObject({
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
