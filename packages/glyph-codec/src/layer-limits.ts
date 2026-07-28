import { fail } from "./error";

export const MAX_LAYER_CONTOUR_COUNT = 1_000_000;
export const MAX_LAYER_POINT_COUNT = 4_000_000;
export const MAX_LAYER_ENTITY_COUNT = 1_000_000;
export const MAX_LAYER_STRING_COUNT = 4_000_000;
export const MAX_LAYER_STRING_BYTES = 64 * 1024 * 1024;
export const MAX_LAYER_LIB_VALUES = 1_000_000;
export const MAX_LAYER_LIB_DEPTH = 64;
export const MAX_LAYER_PAYLOAD_BYTES = 256 * 1024 * 1024;

export function checkLayerLimit(field: string, actual: number, limit: number): void {
  if (actual > limit)
    fail(
      "limit-exceeded",
      `glyph-layer ${field} exceeds implementation limit ${limit}: got ${actual}`,
    );
}

export function checkLayerDepth(depth: number): void {
  if (depth > MAX_LAYER_LIB_DEPTH)
    fail(
      "nesting-limit-exceeded",
      `layer lib nesting exceeds implementation limit ${MAX_LAYER_LIB_DEPTH}`,
    );
}

export function validateFinite(value: number, field: string, index: number): void {
  if (!Number.isFinite(value))
    fail("non-finite-number", `non-finite ${field} value at index ${index}`);
}
