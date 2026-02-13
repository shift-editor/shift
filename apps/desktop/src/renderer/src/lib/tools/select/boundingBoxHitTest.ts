import type { Point2D, Rect2D } from "@shift/types";
import { Vec2 } from "@shift/geo";
import type { BoundingBoxHitResult, CornerHandle } from "@/types/boundingBox";
import type { BoundingRectEdge } from "./cursor";

type YAxisDirection = "up" | "down";
export const BOUNDING_BOX_MIN_VISIBLE_ZOOM = 0.15;

export function isBoundingBoxVisibleAtZoom(zoom: number): boolean {
  return zoom > BOUNDING_BOX_MIN_VISIBLE_ZOOM;
}

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

interface ExpandedHandleRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function getExpandedHandleRect(
  rect: Rect2D,
  offset: number,
  yAxisDirection: YAxisDirection,
): ExpandedHandleRect {
  const left = rect.left - offset;
  const right = rect.right + offset;

  if (yAxisDirection === "up") {
    return {
      left,
      right,
      top: rect.bottom + offset,
      bottom: rect.top - offset,
    };
  }

  return {
    left,
    right,
    top: rect.top - offset,
    bottom: rect.bottom + offset,
  };
}

export function getHandlePositions(
  rect: Rect2D,
  handleOffset: number,
  rotationZoneOffset: number,
  yAxisDirection: YAxisDirection = "up",
): HandlePositions {
  const alignmentRect = getExpandedHandleRect(rect, handleOffset, yAxisDirection);
  const rotationRect = getExpandedHandleRect(rect, rotationZoneOffset, yAxisDirection);
  const centerX = (alignmentRect.left + alignmentRect.right) / 2;
  const centerY = (alignmentRect.top + alignmentRect.bottom) / 2;

  return {
    corners: {
      topLeft: {
        x: alignmentRect.left,
        y: alignmentRect.top,
      },
      topRight: {
        x: alignmentRect.right,
        y: alignmentRect.top,
      },
      bottomLeft: {
        x: alignmentRect.left,
        y: alignmentRect.bottom,
      },
      bottomRight: {
        x: alignmentRect.right,
        y: alignmentRect.bottom,
      },
    },
    midpoints: {
      top: { x: centerX, y: alignmentRect.top },
      bottom: {
        x: centerX,
        y: alignmentRect.bottom,
      },
      left: { x: alignmentRect.left, y: centerY },
      right: { x: alignmentRect.right, y: centerY },
    },
    rotationZones: {
      topLeft: {
        x: rotationRect.left,
        y: rotationRect.top,
      },
      topRight: {
        x: rotationRect.right,
        y: rotationRect.top,
      },
      bottomLeft: {
        x: rotationRect.left,
        y: rotationRect.bottom,
      },
      bottomRight: {
        x: rotationRect.right,
        y: rotationRect.bottom,
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
