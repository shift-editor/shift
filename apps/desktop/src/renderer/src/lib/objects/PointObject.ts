import { Bounds, Vec2, type Rect2D } from "@shift/geo";
import type { GlyphStateGeometry as GlyphGeometry } from "@shift/glyph-state";
import type { ContourId, PointId } from "@shift/types";
import type { ShiftObjectOf } from "@/types";
import type { GlyphNode } from "@/types/node";

/** Source-neutral point resolved in one placed glyph. */
export class PointObject implements ShiftObjectOf<"point"> {
  readonly kind = "point";
  readonly id: PointId;
  readonly geometry: GlyphGeometry;
  readonly contourId: ContourId;
  readonly node: GlyphNode;

  constructor(
    readonly pointId: PointId,
    contourId: ContourId,
    geometry: GlyphGeometry,
    node: GlyphNode,
  ) {
    this.id = pointId;
    this.contourId = contourId;
    this.geometry = geometry;
    this.node = node;
  }

  bounds(): Rect2D | null {
    const point = this.geometry.point(this.pointId);
    if (!point) return null;

    return Bounds.toRect(Bounds.fromPoint(Vec2.add(this.node.position, point)));
  }
}
