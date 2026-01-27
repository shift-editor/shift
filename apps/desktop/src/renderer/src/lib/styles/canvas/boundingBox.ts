import type { DrawStyle } from "./handles";

export interface BoundingBoxHandleStyles {
  handle: DrawStyle & { radius: number; offset: number };
  rotationZoneOffset: number;
}

export function createBoundingBoxHandleStyles(): BoundingBoxHandleStyles {
  return {
    handle: {
      radius: 2.5,
      offset: 10,
      lineWidth: 1,
      strokeStyle: "#606060",
      fillStyle: "#D9D9D9",
      antiAlias: true,
      dashPattern: [],
    },
    rotationZoneOffset: 20,
  };
}
