import { Bounds, Vec2, type Rect2D } from "@shift/geo";
import type { GlyphStateGeometry as GlyphGeometry, SegmentId } from "@shift/glyph-state";
import type { ContourId, PointId } from "@shift/types";
import type { ShiftObjectOf } from "@/types";
import type { GlyphNode } from "@/types/node";

/** Source-neutral segment resolved in one placed glyph. */
export class SegmentObject implements ShiftObjectOf<"segment"> {
  readonly kind = "segment";
  readonly id: SegmentId;
  readonly geometry: GlyphGeometry;
  readonly node: GlyphNode;

  constructor(
    readonly segmentId: SegmentId,
    readonly contourId: ContourId,
    readonly pointIds: readonly PointId[],
    geometry: GlyphGeometry,
    node: GlyphNode,
  ) {
    this.id = segmentId;
    this.geometry = geometry;
    this.node = node;
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
