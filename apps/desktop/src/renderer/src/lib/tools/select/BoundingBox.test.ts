import { describe, expect, it } from "vitest";
import type { Point2D, Rect2D } from "@shift/geo";
import {
  getHandlePositions,
  hitTestResize,
  hitTestRotationZones,
  SELECT_BOUNDING_BOX_STYLE,
} from "./BoundingBox";

const RECT: Rect2D = {
  x: 100,
  y: 100,
  width: 200,
  height: 100,
  left: 100,
  top: 100,
  right: 300,
  bottom: 200,
};
const HANDLES = getHandlePositions(
  RECT,
  SELECT_BOUNDING_BOX_STYLE.handle.offsetPx,
  SELECT_BOUNDING_BOX_STYLE.rotationZoneOffsetPx,
  "down",
);
const HIT_RADIUS = SELECT_BOUNDING_BOX_STYLE.hitRadiusPx;

function resizeHit(point: Point2D) {
  return hitTestResize(RECT, point, HANDLES, HIT_RADIUS);
}

function rotationHit(point: Point2D) {
  return hitTestRotationZones(point, HANDLES.rotationZones, HIT_RADIUS);
}

describe("bounding-box hit classification", () => {
  it.each([
    ["top-left", HANDLES.corners.topLeft],
    ["top-right", HANDLES.corners.topRight],
    ["bottom-left", HANDLES.corners.bottomLeft],
    ["bottom-right", HANDLES.corners.bottomRight],
    ["top", HANDLES.midpoints.top],
    ["bottom", HANDLES.midpoints.bottom],
    ["left", HANDLES.midpoints.left],
    ["right", HANDLES.midpoints.right],
  ] as const)("classifies the %s resize target", (edge, point) => {
    expect(resizeHit(point)).toEqual({ type: "resize", edge });
  });

  it.each([
    ["top-left", HANDLES.rotationZones.topLeft],
    ["top-right", HANDLES.rotationZones.topRight],
    ["bottom-left", HANDLES.rotationZones.bottomLeft],
    ["bottom-right", HANDLES.rotationZones.bottomRight],
  ] as const)("classifies the %s rotation target", (corner, point) => {
    expect(rotationHit(point)).toEqual({ type: "rotate", corner });
  });

  it.each([
    ["inside", { x: 200, y: 150 }],
    ["far outside", { x: 500, y: 500 }],
  ] as const)("returns no target %s the bounding box", (_description, point) => {
    expect(resizeHit(point)).toBeNull();
    expect(rotationHit(point)).toBeNull();
  });
});
