import { Vec2, type Point2D } from "@shift/geo";
import type { PositionCondition } from "@/types/positionEdit";
import type { GlyphLayer } from "../Glyph";
import { AngleSnap } from "./AngleSnap";
import { PositionReference } from "./PositionReference";

/** Quantizes a vector's direction while preserving its length. */
export class DirectionSnap {
  readonly #angle: AngleSnap;
  #pivot: PositionReference | null = null;

  private constructor(angle: AngleSnap) {
    this.#angle = angle;
  }

  static everyDegrees(degrees: number, condition?: PositionCondition): DirectionSnap {
    return new DirectionSnap(AngleSnap.everyDegrees(degrees, condition));
  }

  /**
   * Configures the fixed pivot for snapping a moving reference's direction.
   *
   * @remarks
   * Configure before attaching to a movement edit. The edit freezes the pivot on
   * attachment and requires a separate moving reference through `MoveEdit.from`.
   * Without a pivot, snapping quantizes the drag delta instead.
   *
   * @param reference - Point, anchor, or glyph-local position at the axes' intersection.
   * @returns This snap configuration for fluent chaining.
   */
  around(reference: PositionReference): this {
    this.#pivot = reference;
    return this;
  }

  /**
   * Resolves a snapshot of the configured pivot in an authored layer.
   *
   * @param layer - Layer that must own the pivot point or anchor.
   * @returns A fresh glyph-local position, or null when no pivot is configured.
   * @throws {Error} When the configured pivot does not exist in the layer.
   */
  resolvePivot(layer: GlyphLayer): Point2D | null {
    if (!this.#pivot) return null;

    const position = this.#pivot.resolve(layer);
    if (!position) throw new Error("Direction snap pivot does not exist in this glyph layer");

    return position;
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
