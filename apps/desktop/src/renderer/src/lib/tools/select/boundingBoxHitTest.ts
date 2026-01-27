import type { Point2D, Rect2D } from "@shift/types";
import { Vec2 } from "@shift/geo";
import type { BoundingBoxHitResult, CornerHandle } from "@/types/boundingBox";
import type { BoundingRectEdge } from "./cursor";

export interface HandlePositions {
  corners: {
    topLeft: Point2D;
    topRight: Point2D;
    bottomLeft: Point2D;
    bottomRight: Point2D;
  };
  midpoints: {
    top: Point2D;
    bottom: Point2D;
    left: Point2D;
    right: Point2D;
  };
  rotationZones: {
    topLeft: Point2D;
    topRight: Point2D;
    bottomLeft: Point2D;
    bottomRight: Point2D;
  };
}

export function getHandlePositions(
  rect: Rect2D,
  handleOffset: number,
  rotationZoneOffset: number,
): HandlePositions {
  const diagonalOffset = handleOffset / Math.SQRT2;
  const rotationDiagonalOffset = rotationZoneOffset / Math.SQRT2;

  return {
    corners: {
      topLeft: {
        x: rect.left - diagonalOffset,
        y: rect.bottom + diagonalOffset,
      },
      topRight: {
        x: rect.right + diagonalOffset,
        y: rect.bottom + diagonalOffset,
      },
      bottomLeft: {
        x: rect.left - diagonalOffset,
        y: rect.top - diagonalOffset,
      },
      bottomRight: {
        x: rect.right + diagonalOffset,
        y: rect.top - diagonalOffset,
      },
    },
    midpoints: {
      top: { x: (rect.left + rect.right) / 2, y: rect.bottom + handleOffset },
      bottom: {
        x: (rect.left + rect.right) / 2,
        y: rect.top - handleOffset,
      },
      left: { x: rect.left - handleOffset, y: (rect.top + rect.bottom) / 2 },
      right: { x: rect.right + handleOffset, y: (rect.top + rect.bottom) / 2 },
    },
    rotationZones: {
      topLeft: {
        x: rect.left - rotationDiagonalOffset,
        y: rect.bottom + rotationDiagonalOffset,
      },
      topRight: {
        x: rect.right + rotationDiagonalOffset,
        y: rect.bottom + rotationDiagonalOffset,
      },
      bottomLeft: {
        x: rect.left - rotationDiagonalOffset,
        y: rect.top - rotationDiagonalOffset,
      },
      bottomRight: {
        x: rect.right + rotationDiagonalOffset,
        y: rect.top - rotationDiagonalOffset,
      },
    },
  };
}

export function hitTestBoundingBox(
  pos: Point2D,
  rect: Rect2D,
  hitRadius: number,
  handleOffset: number,
  rotationZoneOffset: number,
): BoundingBoxHitResult {
  const handles = getHandlePositions(rect, handleOffset, rotationZoneOffset);

  const resizeResult = hitTestResizeHandles(pos, handles, hitRadius);
  if (resizeResult) {
    return resizeResult;
  }

  const rotationResult = hitTestRotationZones(pos, handles.rotationZones, hitRadius);
  if (rotationResult) {
    return rotationResult;
  }

  return null;
}

function hitTestRotationZones(
  pos: Point2D,
  rotationZones: HandlePositions["rotationZones"],
  hitRadius: number,
): BoundingBoxHitResult {
  const corners: Array<[keyof HandlePositions["rotationZones"], CornerHandle]> = [
    ["topLeft", "top-left"],
    ["topRight", "top-right"],
    ["bottomLeft", "bottom-left"],
    ["bottomRight", "bottom-right"],
  ];

  for (const [key, corner] of corners) {
    if (Vec2.dist(pos, rotationZones[key]) < hitRadius) {
      return { type: "rotate", corner };
    }
  }

  return null;
}

function hitTestResizeHandles(
  pos: Point2D,
  handles: HandlePositions,
  hitRadius: number,
): BoundingBoxHitResult {
  const cornerChecks: Array<[keyof HandlePositions["corners"], Exclude<BoundingRectEdge, null>]> = [
    ["topLeft", "top-left"],
    ["topRight", "top-right"],
    ["bottomLeft", "bottom-left"],
    ["bottomRight", "bottom-right"],
  ];

  for (const [key, edge] of cornerChecks) {
    if (Vec2.dist(pos, handles.corners[key]) < hitRadius) {
      return { type: "resize", edge };
    }
  }

  const midpointChecks: Array<
    [keyof HandlePositions["midpoints"], Exclude<BoundingRectEdge, null>]
  > = [
    ["top", "top"],
    ["bottom", "bottom"],
    ["left", "left"],
    ["right", "right"],
  ];

  for (const [key, edge] of midpointChecks) {
    if (Vec2.dist(pos, handles.midpoints[key]) < hitRadius) {
      return { type: "resize", edge };
    }
  }

  return null;
}
