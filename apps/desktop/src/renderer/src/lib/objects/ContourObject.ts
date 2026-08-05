import { Bounds, Vec2, type Rect2D } from "@shift/geo";
import type { GlyphStateGeometry as GlyphGeometry } from "@shift/glyph-state";
import type { ContourId } from "@shift/types";
import type { ShiftObjectOf } from "@/types";
import type { GlyphNode } from "@/types/node";

/** Source-neutral contour resolved in one placed glyph. */
export class ContourObject implements ShiftObjectOf<"contour"> {
  readonly kind = "contour";
  readonly id: ContourId;
  readonly geometry: GlyphGeometry;
  readonly node: GlyphNode;

  constructor(
    readonly contourId: ContourId,
    geometry: GlyphGeometry,
    node: GlyphNode,
  ) {
    this.id = contourId;
    this.geometry = geometry;
    this.node = node;
  }

  bounds(): Rect2D | null {
    const bounds = this.geometry.contour(this.contourId)?.bounds;
    if (!bounds) return null;

    return Bounds.toRect({
      min: Vec2.add(this.node.position, bounds.min),
      max: Vec2.add(this.node.position, bounds.max),
    });
  }
}
