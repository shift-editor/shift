import { Mat } from "@shift/geo";
import type { Point2D } from "@shift/types";
import type { AffineTransformPayload } from "@shared/bridge/FontEngineAPI";

function fromMat(mat: Pick<Mat, "a" | "b" | "c" | "d" | "e" | "f">): AffineTransformPayload {
  return {
    a: mat.a,
    b: mat.b,
    c: mat.c,
    d: mat.d,
    e: mat.e,
    f: mat.f,
  };
}

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

export function createRotationTransform(center: Point2D, angle: number): AffineTransformPayload {
  const matrix = Mat.Translate(center.x, center.y)
    .multiply(Mat.Rotate(angle))
    .multiply(Mat.Translate(-center.x, -center.y));
  return fromMat(matrix);
}

export function createScaleTransform(
  anchor: Point2D,
  sx: number,
  sy: number,
): AffineTransformPayload {
  const matrix = Mat.Translate(anchor.x, anchor.y)
    .multiply(Mat.Scale(sx, sy))
    .multiply(Mat.Translate(-anchor.x, -anchor.y));
  return fromMat(matrix);
}
