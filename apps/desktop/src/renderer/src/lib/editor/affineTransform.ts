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

export function createRotationTransform(origin: Point2D, angle: number): AffineTransformPayload {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    e: origin.x - cos * origin.x + sin * origin.y,
    f: origin.y - sin * origin.x - cos * origin.y,
  };
}

export function createScaleTransform(
  origin: Point2D,
  scaleX: number,
  scaleY: number,
): AffineTransformPayload {
  return {
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    e: origin.x - scaleX * origin.x,
    f: origin.y - scaleY * origin.y,
  };
}
