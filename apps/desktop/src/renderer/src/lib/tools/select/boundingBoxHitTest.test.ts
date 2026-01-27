import { describe, it, expect } from "vitest";
import { hitTestBoundingBox, getHandlePositions } from "./boundingBoxHitTest";
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

  it("returns corner positions offset diagonally outward from visual corners", () => {
    const rect = createRect(100, 100, 200, 150);
    const positions = getHandlePositions(rect, handleOffset, rotationZoneOffset);
    const diagonalOffset = handleOffset / Math.SQRT2;

    expect(positions.corners.topLeft.x).toBeCloseTo(100 - diagonalOffset);
    expect(positions.corners.topLeft.y).toBeCloseTo(250 + diagonalOffset);

    expect(positions.corners.topRight.x).toBeCloseTo(300 + diagonalOffset);
    expect(positions.corners.topRight.y).toBeCloseTo(250 + diagonalOffset);

    expect(positions.corners.bottomLeft.x).toBeCloseTo(100 - diagonalOffset);
    expect(positions.corners.bottomLeft.y).toBeCloseTo(100 - diagonalOffset);

    expect(positions.corners.bottomRight.x).toBeCloseTo(300 + diagonalOffset);
    expect(positions.corners.bottomRight.y).toBeCloseTo(100 - diagonalOffset);
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
    const diagonalOffset = rotationZoneOffset / Math.SQRT2;

    expect(positions.rotationZones.topLeft.x).toBeCloseTo(100 - diagonalOffset);
    expect(positions.rotationZones.topLeft.y).toBeCloseTo(200 + diagonalOffset);

    expect(positions.rotationZones.topRight.x).toBeCloseTo(300 + diagonalOffset);
    expect(positions.rotationZones.topRight.y).toBeCloseTo(200 + diagonalOffset);

    expect(positions.rotationZones.bottomLeft.x).toBeCloseTo(100 - diagonalOffset);
    expect(positions.rotationZones.bottomLeft.y).toBeCloseTo(100 - diagonalOffset);

    expect(positions.rotationZones.bottomRight.x).toBeCloseTo(300 + diagonalOffset);
    expect(positions.rotationZones.bottomRight.y).toBeCloseTo(100 - diagonalOffset);
  });
});

describe("hitTestBoundingBox", () => {
  const rect = createRect(100, 100, 200, 100);
  const hitRadius = 10;
  const handleOffset = 5;
  const rotationZoneOffset = 15;

  describe("resize corner handles", () => {
    it("detects top-left resize handle", () => {
      const diagonalOffset = handleOffset / Math.SQRT2;
      const pos = { x: 100 - diagonalOffset, y: 200 + diagonalOffset };
      const result = hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);
      expect(result).toEqual({ type: "resize", edge: "top-left" });
    });

    it("detects top-right resize handle", () => {
      const diagonalOffset = handleOffset / Math.SQRT2;
      const pos = { x: 300 + diagonalOffset, y: 200 + diagonalOffset };
      const result = hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);
      expect(result).toEqual({ type: "resize", edge: "top-right" });
    });

    it("detects bottom-left resize handle", () => {
      const diagonalOffset = handleOffset / Math.SQRT2;
      const pos = { x: 100 - diagonalOffset, y: 100 - diagonalOffset };
      const result = hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);
      expect(result).toEqual({ type: "resize", edge: "bottom-left" });
    });

    it("detects bottom-right resize handle", () => {
      const diagonalOffset = handleOffset / Math.SQRT2;
      const pos = { x: 300 + diagonalOffset, y: 100 - diagonalOffset };
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
      const diagonalOffset = rotationZoneOffset / Math.SQRT2;
      const pos = { x: 100 - diagonalOffset, y: 200 + diagonalOffset };
      const result = hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);
      expect(result).toEqual({ type: "rotate", corner: "top-left" });
    });

    it("detects top-right rotation zone", () => {
      const diagonalOffset = rotationZoneOffset / Math.SQRT2;
      const pos = { x: 300 + diagonalOffset, y: 200 + diagonalOffset };
      const result = hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);
      expect(result).toEqual({ type: "rotate", corner: "top-right" });
    });

    it("detects bottom-left rotation zone", () => {
      const diagonalOffset = rotationZoneOffset / Math.SQRT2;
      const pos = { x: 100 - diagonalOffset, y: 100 - diagonalOffset };
      const result = hitTestBoundingBox(pos, rect, hitRadius, handleOffset, rotationZoneOffset);
      expect(result).toEqual({ type: "rotate", corner: "bottom-left" });
    });

    it("detects bottom-right rotation zone", () => {
      const diagonalOffset = rotationZoneOffset / Math.SQRT2;
      const pos = { x: 300 + diagonalOffset, y: 100 - diagonalOffset };
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
      const handleDiagonalOffset = handleOffset / Math.SQRT2;
      const resizePos = {
        x: 100 - handleDiagonalOffset,
        y: 200 + handleDiagonalOffset,
      };

      const rotationDiagonalOffset = rotationZoneOffset / Math.SQRT2;
      const rotationPos = {
        x: 100 - rotationDiagonalOffset,
        y: 200 + rotationDiagonalOffset,
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
