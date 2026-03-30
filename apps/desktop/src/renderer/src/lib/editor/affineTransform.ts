import type { Point2D } from "@shift/types";
import type { AffineTransformPayload } from "@shared/bridge/FontEngineAPI";

export function createTranslationTransform(delta: Point2D): AffineTransformPayload {
  return {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: delta.x,
    f: delta.y,
  };
}
