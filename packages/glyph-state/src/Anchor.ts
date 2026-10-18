import type { Point2D } from "@shift/geo";
import {
  GLYPH_ANCHOR_VALUE_COUNT,
  GLYPH_POSITION_VALUE_OFFSETS,
  type AnchorData,
  type AnchorId,
  type GlyphStructure,
} from "@shift/types";
import { Point, type PointHit } from "./Point";
import { anchorsValueOffset } from "./valueLayout";

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
    const cursor = anchorsValueOffset(structure);
    return structure.anchors.map(
      (anchor, index) => new Anchor(anchor, values, cursor + index * GLYPH_ANCHOR_VALUE_COUNT),
    );
  }

  /**
   * Return the value-buffer offset for every anchor in a glyph structure.
   *
   * Offsets point to each anchor's `x` coordinate; `y` is stored immediately
   * after it. This is used by bulk position updates.
   */
  static valueOffsets(structure: GlyphStructure): Map<AnchorId, number> {
    const offsets = new Map<AnchorId, number>();
    let cursor = anchorsValueOffset(structure);
    for (const anchor of structure.anchors) {
      offsets.set(anchor.id, cursor);
      cursor += GLYPH_ANCHOR_VALUE_COUNT;
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
    return this.#values[this.#cursor + GLYPH_POSITION_VALUE_OFFSETS.x];
  }

  get y(): number {
    return this.#values[this.#cursor + GLYPH_POSITION_VALUE_OFFSETS.y];
  }

  hit(pos: Point2D, radius: number): AnchorHit | null {
    return Point.hit(this, pos, radius);
  }
}
