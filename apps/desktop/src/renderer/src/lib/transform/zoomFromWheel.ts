import { clamp } from "@/lib/utils/utils";

const DOM_DELTA_LINE = 1;

export interface ZoomFromWheelOptions {
  lineStep?: number;
  pixelDivisor?: number;
  minMultiplier?: number;
  maxMultiplier?: number;
}

const DEFAULT_OPTIONS: Required<ZoomFromWheelOptions> = {
  lineStep: 0.08,
  pixelDivisor: 300,
  minMultiplier: 0.9,
  maxMultiplier: 1.1,
};

export function zoomMultiplierFromWheel(
  deltaY: number,
  deltaMode: number,
  options?: ZoomFromWheelOptions,
): number {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { lineStep, pixelDivisor, minMultiplier, maxMultiplier } = opts;

  let multiplier: number;
  if (deltaMode === DOM_DELTA_LINE) {
    multiplier = 1 - lineStep * deltaY;
  } else {
    multiplier = 1 - deltaY / pixelDivisor;
  }

  return clamp(multiplier, minMultiplier, maxMultiplier);
}
