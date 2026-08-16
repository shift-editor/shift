import { Vec2, type Point2D } from "@shift/geo";
import type { PositionCondition } from "@/types/positionEdit";
import { AngleSnap } from "./AngleSnap";

/** Quantizes a movement vector's direction while preserving its length. */
export class DirectionSnap {
  readonly #angle: AngleSnap;

  private constructor(angle: AngleSnap) {
    this.#angle = angle;
  }

  static everyDegrees(degrees: number, condition?: PositionCondition): DirectionSnap {
    return new DirectionSnap(AngleSnap.everyDegrees(degrees, condition));
  }

  apply(delta: Point2D): Point2D | null {
    const snappedAngle = this.#angle.apply(Vec2.angle(delta));
    if (snappedAngle === null) return null;

    const length = Vec2.len(delta);
    return {
      x: length * Math.cos(snappedAngle),
      y: length * Math.sin(snappedAngle),
    };
  }
}
