import type { PointId } from "@shift/types";

/**
 * Internal helper shape for geometry transforms that need stable point identity
 * plus absolute position. Keep this local to transform/model internals rather
 * than exporting it as a broader app-level concept.
 */
export interface PointPosition {
  readonly id: PointId;
  readonly x: number;
  readonly y: number;
}
