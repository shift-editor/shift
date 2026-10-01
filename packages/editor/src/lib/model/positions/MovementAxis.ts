import { Vec2, type Point2D } from "@shift/geo";
import type { GlyphLayer } from "../Glyph";
import type { PositionReference } from "./PositionReference";

/** Restricts movement to the line through two positions, frozen when an edit attaches it. */
export class MovementAxis {
  readonly #from: PositionReference;
  readonly #to: PositionReference;

  private constructor(from: PositionReference, to: PositionReference) {
    this.#from = from;
    this.#to = to;
  }

  /**
   * Configures an axis parallel to the line from one position to another.
   *
   * @param from - Position at one end of the axis direction.
   * @param to - Position at the other end of the axis direction.
   * @returns An axis that an edit resolves once, before its first preview.
   */
  static between(from: PositionReference, to: PositionReference): MovementAxis {
    return new MovementAxis(from, to);
  }

  /**
   * Resolves a snapshot of the axis direction in an authored layer.
   *
   * @param layer - Layer that must own both ends of the axis.
   * @returns The unnormalized direction, or null when the ends coincide.
   * @throws {Error} When either end does not exist in the layer.
   */
  resolveDirection(layer: GlyphLayer): Point2D | null {
    const from = this.#from.resolve(layer);
    const to = this.#to.resolve(layer);
    if (!from || !to) throw new Error("Movement axis end does not exist in this glyph layer");

    const direction = Vec2.sub(to, from);
    return Vec2.len(direction) > 0 ? direction : null;
  }
}
