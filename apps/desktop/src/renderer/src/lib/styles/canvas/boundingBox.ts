import type { DrawStyle } from "./handles";

export interface BoundingBoxHandleStyles {
  handle: DrawStyle & { radius: number; offset: number };
  rotationZoneOffset: number;
}

export function createBoundingBoxHandleStyles(): BoundingBoxHandleStyles {
  return {
    handle: {
      radius: 3,
      offset: 15,
      lineWidth: 3,
      strokeStyle: "#606060",
      fillStyle: "#D9D9D9",
      antiAlias: true,
      dashPattern: [],
    },
    rotationZoneOffset: 20,
  };
}
