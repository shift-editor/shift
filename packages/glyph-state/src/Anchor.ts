import type { Point2D } from "@shift/geo";
import type { AnchorData, AnchorId, GlyphStructure } from "@shift/types";
import { Point, type PointHit } from "./Point";

export interface AnchorHit extends PointHit {}

/**
 * Geometry view for one glyph anchor.
 *
 * Anchor metadata lives in `GlyphStructure`; the `x`/`y` coordinates are read
 * from the shared glyph value buffer. Like other glyph-state classes, this is a
 * snapshot-style view and does not mutate the underlying glyph.
 */
export class Anchor {
  readonly #data: AnchorData;
  readonly #values: Float64Array;
  readonly #cursor: number;

  constructor(data: AnchorData, values: Float64Array, cursor: number) {
    this.#data = data;
    this.#values = values;
    this.#cursor = cursor;
  }

  static fromStructure(structure: GlyphStructure, values: Float64Array): readonly Anchor[] {
    let cursor = 1;
    for (const contour of structure.contours) cursor += contour.points.length * 2;

    return structure.anchors.map((anchor, index) => new Anchor(anchor, values, cursor + index * 2));
  }

  /**
   * Return the value-buffer offset for every anchor in a glyph structure.
   *
   * Offsets point to each anchor's `x` coordinate; `y` is stored immediately
   * after it. This is used by bulk position updates.
   */
  static valueOffsets(structure: GlyphStructure): Map<AnchorId, number> {
    const offsets = new Map<AnchorId, number>();
    let cursor = 1;
    for (const contour of structure.contours) cursor += contour.points.length * 2;
    for (const anchor of structure.anchors) {
      offsets.set(anchor.id, cursor);
      cursor += 2;
    }
    return offsets;
  }

  get id(): AnchorId {
    return this.#data.id;
  }

  get name(): string | undefined {
    return this.#data.name;
  }

  get x(): number {
    return this.#values[this.#cursor];
  }

  get y(): number {
    return this.#values[this.#cursor + 1];
  }

  hit(pos: Point2D, radius: number): AnchorHit | null {
    return Point.hit(this, pos, radius);
  }
}
