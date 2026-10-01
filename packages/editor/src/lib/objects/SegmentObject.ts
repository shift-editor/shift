import { Bounds, Vec2, type Rect2D } from "@shift/geo";
import type { GlyphGeometry, SegmentId } from "@shift/glyph-state";
import type { ContourId, PointId } from "@shift/types";
import { track } from "../signals/index";
import type { GlyphLayer } from "../model/Glyph";
import type { ShiftObjectOf } from "../../types/object";
import type { GlyphNode } from "../../types/node";

/** Source-neutral segment resolved in one placed glyph. */
export class SegmentObject implements ShiftObjectOf<"segment"> {
  readonly kind = "segment";
  readonly id: SegmentId;
  readonly #geometry: GlyphGeometry;
  readonly layer: GlyphLayer | null;
  readonly node: GlyphNode;

  constructor(
    readonly segmentId: SegmentId,
    readonly contourId: ContourId,
    readonly pointIds: readonly PointId[],
    geometry: GlyphGeometry,
    node: GlyphNode,
    layer: GlyphLayer | null = null,
  ) {
    this.id = segmentId;
    this.#geometry = geometry;
    this.layer = layer;
    this.node = node;
  }

  get geometry(): GlyphGeometry {
    if (!this.layer) return this.#geometry;

    track(this.layer.structureCell);
    track(this.layer.buffersChangedCell);
    return this.layer.geometry;
  }

  bounds(): Rect2D | null {
    const segment = this.geometry.segment(this.segmentId);
    if (!segment) return null;

    return Bounds.toRect({
      min: Vec2.add(this.node.position, segment.bounds.min),
      max: Vec2.add(this.node.position, segment.bounds.max),
    });
  }
}
