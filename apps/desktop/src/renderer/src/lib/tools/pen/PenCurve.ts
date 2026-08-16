import { Curve, Vec2, type CubicCurve } from "@shift/geo";
import type { PenCurve } from "./types";

/** Resolves speculative Pen state into the exact cubic previewed and committed. */
export function penCurveGeometry(curve: PenCurve): CubicCurve {
  const controlStart =
    curve.start.kind === "corner"
      ? Vec2.lerp(curve.start.position, curve.anchorPosition, 1 / 3)
      : curve.start.outgoingHandlePosition;
  const controlEnd = Vec2.mirror(curve.handlePosition, curve.anchorPosition);

  return Curve.cubic(curve.start.position, controlStart, controlEnd, curve.anchorPosition);
}
