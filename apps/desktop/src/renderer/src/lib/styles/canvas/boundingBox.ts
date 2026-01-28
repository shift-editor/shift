import { ThemeTokens } from "../theme";
import type { DrawStyle } from "./handles";

export interface BoundingBoxHandleStyles {
  handle: DrawStyle & { radius: number; offset: number };
  rotationZoneOffset: number;
}

export function createBoundingBoxHandleStyles(theme: ThemeTokens): BoundingBoxHandleStyles {
  const { black } = theme.canvas;

  return {
    handle: {
      radius: 4,
      offset: 15,
      lineWidth: 1,
      strokeStyle: black,
      fillStyle: "transparent",
      antiAlias: true,
      dashPattern: [],
    },
    rotationZoneOffset: 20,
  };
}
