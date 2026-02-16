import type { DrawStyle } from "./handles";

/**
 * Renderer-ready style where width and dash values are already expressed in the
 * current render space (UPM for scene-space rendering, px for screen-space rendering).
 */
export interface ResolvedDrawStyle {
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  antiAlias?: boolean;
  dashPattern: number[];
}

export function resolveDrawStyle(
  style: DrawStyle,
  pxToUnits: (pixels: number) => number,
): ResolvedDrawStyle {
  return {
    ...style,
    lineWidth: pxToUnits(style.lineWidth),
    dashPattern: style.dashPattern.map((value) => pxToUnits(value)),
  };
}
