import { describe, it, expect } from "vitest";
import {
  hitTestBoundingBox,
  getHandlePositions,
  isBoundingBoxVisibleAtZoom,
  BOUNDING_BOX_MIN_VISIBLE_ZOOM,
} from "./boundingBoxHitTest";
import type { Rect2D } from "@shift/types";

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

describe("getHandlePositions", () => {
  const handleOffset = 5;
  const rotationZoneOffset = 15;

  it("returns corner positions aligned with edge offsets", () => {
    const rect = createRect(100, 100, 200, 150);
    const positions = getHandlePositions(rect, handleOffset, rotationZoneOffset);

    expect(positions.corners.topLeft.x).toBeCloseTo(100 - handleOffset);
    expect(positions.corners.topLeft.y).toBeCloseTo(250 + handleOffset);

    expect(positions.corners.topRight.x).toBeCloseTo(300 + handleOffset);
    expect(positions.corners.topRight.y).toBeCloseTo(250 + handleOffset);

    expect(positions.corners.bottomLeft.x).toBeCloseTo(100 - handleOffset);
    expect(positions.corners.bottomLeft.y).toBeCloseTo(100 - handleOffset);

    expect(positions.corners.bottomRight.x).toBeCloseTo(300 + handleOffset);
    expect(positions.corners.bottomRight.y).toBeCloseTo(100 - handleOffset);
  });

  it("returns midpoint positions offset perpendicularly outward from visual edges", () => {
    const rect = createRect(100, 100, 200, 100);
    const positions = getHandlePositions(rect, handleOffset, rotationZoneOffset);

    expect(positions.midpoints.top).toEqual({ x: 200, y: 200 + handleOffset });
    expect(positions.midpoints.bottom).toEqual({
      x: 200,
      y: 100 - handleOffset,
    });
    expect(positions.midpoints.left).toEqual({ x: 100 - handleOffset, y: 150 });
    expect(positions.midpoints.right).toEqual({
      x: 300 + handleOffset,
      y: 150,
    });
  });

  it("returns rotation zone positions outside visual corners", () => {
    const rect = createRect(100, 100, 200, 100);
    const positions = getHandlePositions(rect, handleOffset, rotationZoneOffset);

    expect(positions.rotationZones.topLeft.x).toBeCloseTo(100 - rotationZoneOffset);
    expect(positions.rotationZones.topLeft.y).toBeCloseTo(200 + rotationZoneOffset);

    expect(positions.rotationZones.topRight.x).toBeCloseTo(300 + rotationZoneOffset);
    expect(positions.rotationZones.topRight.y).toBeCloseTo(200 + rotationZoneOffset);

    expect(positions.rotationZones.bottomLeft.x).toBeCloseTo(100 - rotationZoneOffset);
    expect(positions.rotationZones.bottomLeft.y).toBeCloseTo(100 - rotationZoneOffset);

    expect(positions.rotationZones.bottomRight.x).toBeCloseTo(300 + rotationZoneOffset);
    expect(positions.rotationZones.bottomRight.y).toBeCloseTo(100 - rotationZoneOffset);
  });

  it("supports y-down coordinates by aligning handles to an expanded screen-space box", () => {
    const rect = createRect(100, 100, 200, 100);
    const positions = getHandlePositions(rect, handleOffset, rotationZoneOffset, "down");

    expect(positions.corners.topLeft).toEqual({ x: 100 - handleOffset, y: 100 - handleOffset });
    expect(positions.corners.topRight).toEqual({ x: 300 + handleOffset, y: 100 - handleOffset });
    expect(positions.corners.bottomLeft).toEqual({
      x: 100 - handleOffset,
      y: 200 + handleOffset,
    });
    expect(positions.corners.bottomRight).toEqual({
      x: 300 + handleOffset,
      y: 200 + handleOffset,
    });

    expect(positions.midpoints.top).toEqual({ x: 200, y: 100 - handleOffset });
    expect(positions.midpoints.bottom).toEqual({
      x: 200,
      y: 200 + handleOffset,
    });
    expect(positions.midpoints.left).toEqual({ x: 100 - handleOffset, y: 150 });
    expect(positions.midpoints.right).toEqual({ x: 300 + handleOffset, y: 150 });
  });
});

describe("isBoundingBoxVisibleAtZoom", () => {
  it("returns false at the minimum zoom threshold", () => {
    expect(isBoundingBoxVisibleAtZoom(BOUNDING_BOX_MIN_VISIBLE_ZOOM)).toBe(false);
  });

  it("returns false below the minimum zoom threshold", () => {
    expect(isBoundingBoxVisibleAtZoom(0.1)).toBe(false);
  });

  it("returns true above the minimum zoom threshold", () => {
    expect(isBoundingBoxVisibleAtZoom(0.151)).toBe(true);
  });
});

describe("hitTestBoundingBox", () => {
  const rect = createRect(100, 100, 200, 100);
  const hitRadius = 10;
  const handleOffset = 5;
  const rotationZoneOffset = 15;

  describe("resize corner handles", () => {
    it("detects top-left resize handle", () => {
      const pos = { x: 100 - handleOffset, y: 200 + handleOffset };
      const result = hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);
      expect(result).toEqual({ type: "resize", edge: "top-left" });
    });

    it("detects top-right resize handle", () => {
      const pos = { x: 300 + handleOffset, y: 200 + handleOffset };
      const result = hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);
      expect(result).toEqual({ type: "resize", edge: "top-right" });
    });

    it("detects bottom-left resize handle", () => {
      const pos = { x: 100 - handleOffset, y: 100 - handleOffset };
      const result = hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);
      expect(result).toEqual({ type: "resize", edge: "bottom-left" });
    });

    it("detects bottom-right resize handle", () => {
      const pos = { x: 300 + handleOffset, y: 100 - handleOffset };
      const result = hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);
      expect(result).toEqual({ type: "resize", edge: "bottom-right" });
    });
  });

  describe("resize midpoint handles", () => {
    it("detects top midpoint resize handle", () => {
      const result = hitTestBoundingBox(
        { x: 200, y: 200 + handleOffset },
        rect,
        hitRadius,
        handleOffset,
        rotationZoneOffset,
      );
      expect(result).toEqual({ type: "resize", edge: "top" });
    });

    it("detects bottom midpoint resize handle", () => {
      const result = hitTestBoundingBox(
        { x: 200, y: 100 - handleOffset },
        rect,
        hitRadius,
        handleOffset,
        rotationZoneOffset,
      );
      expect(result).toEqual({ type: "resize", edge: "bottom" });
    });

    it("detects left midpoint resize handle", () => {
      const result = hitTestBoundingBox(
        { x: 100 - handleOffset, y: 150 },
        rect,
        hitRadius,
        handleOffset,
        rotationZoneOffset,
      );
      expect(result).toEqual({ type: "resize", edge: "left" });
    });

    it("detects right midpoint resize handle", () => {
      const result = hitTestBoundingBox(
        { x: 300 + handleOffset, y: 150 },
        rect,
        hitRadius,
        handleOffset,
        rotationZoneOffset,
      );
      expect(result).toEqual({ type: "resize", edge: "right" });
    });
  });

  describe("rotation zones", () => {
    it("detects top-left rotation zone", () => {
      const pos = { x: 100 - rotationZoneOffset, y: 200 + rotationZoneOffset };
      const result = hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);
      expect(result).toEqual({ type: "rotate", corner: "top-left" });
    });

    it("detects top-right rotation zone", () => {
      const pos = { x: 300 + rotationZoneOffset, y: 200 + rotationZoneOffset };
      const result = hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);
      expect(result).toEqual({ type: "rotate", corner: "top-right" });
    });

    it("detects bottom-left rotation zone", () => {
      const pos = { x: 100 - rotationZoneOffset, y: 100 - rotationZoneOffset };
      const result = hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);
      expect(result).toEqual({ type: "rotate", corner: "bottom-left" });
    });

    it("detects bottom-right rotation zone", () => {
      const pos = { x: 300 + rotationZoneOffset, y: 100 - rotationZoneOffset };
      const result = hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);
      expect(result).toEqual({ type: "rotate", corner: "bottom-right" });
    });
  });

  describe("no hit", () => {
    it("returns null when clicking inside the bounding box", () => {
      const result = hitTestBoundingBox(
        { x: 200, y: 150 },
        rect,
        hitRadius,
        handleOffset,
        rotationZoneOffset,
      );
      expect(result).toBeNull();
    });

    it("returns null when clicking far outside the bounding box", () => {
      const result = hitTestBoundingBox(
        { x: 500, y: 500 },
        rect,
        hitRadius,
        handleOffset,
        rotationZoneOffset,
      );
      expect(result).toBeNull();
    });
  });

  describe("priority", () => {
    it("checks resize handles before rotation zones", () => {
      const resizePos = {
        x: 100 - handleOffset,
        y: 200 + handleOffset,
      };

      const rotationPos = {
        x: 100 - rotationZoneOffset,
        y: 200 + rotationZoneOffset,
      };

      const resizeResult = hitTestBoundingBox(
        resizePos,
        rect,
        hitRadius,
        handleOffset,
        rotationZoneOffset,
      );
      const rotationResult = hitTestBoundingBox(
        rotationPos,
        rect,
        hitRadius,
        handleOffset,
        rotationZoneOffset,
      );

      expect(resizeResult?.type).toBe("resize");
      expect(rotationResult?.type).toBe("rotate");
    });
  });
});
