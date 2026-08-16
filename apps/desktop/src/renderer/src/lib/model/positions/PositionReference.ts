import type { Point2D } from "@shift/geo";
import type { AnchorId, PointId } from "@shift/types";
import type { GlyphLayer, GlyphLayerPositionTarget } from "../Glyph";

/** Frozen reference used to turn a movement delta into a snappable position. */
export class PositionReference {
  readonly #target: GlyphLayerPositionTarget | null;
  readonly #position: Point2D | null;

  private constructor(target: GlyphLayerPositionTarget | null, position: Point2D | null) {
    this.#target = target;
    this.#position = position ? { ...position } : null;
  }

  static point(pointId: PointId): PositionReference {
    return new PositionReference({ kind: "point", id: pointId }, null);
  }

  static anchor(anchorId: AnchorId): PositionReference {
    return new PositionReference({ kind: "anchor", id: anchorId }, null);
  }

  static position(position: Point2D): PositionReference {
    return new PositionReference(null, position);
  }

  resolve(layer: GlyphLayer): Point2D | null {
    if (this.#position) return { ...this.#position };
    if (!this.#target) return null;

    const position = layer.positionsFor([this.#target])[0];
    return position ? { x: position.x, y: position.y } : null;
  }
}
