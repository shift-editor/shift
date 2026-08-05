import { Bounds, Vec2, type Rect2D } from "@shift/geo";
import type { GlyphStateGeometry as GlyphGeometry } from "@shift/glyph-state";
import type { AnchorId } from "@shift/types";
import type { ShiftObjectOf } from "@/types";
import type { GlyphNode } from "@/types/node";

/** Source-neutral anchor resolved in one placed glyph. */
export class AnchorObject implements ShiftObjectOf<"anchor"> {
  readonly kind = "anchor";
  readonly id: AnchorId;
  readonly geometry: GlyphGeometry;
  readonly node: GlyphNode;

  constructor(
    readonly anchorId: AnchorId,
    geometry: GlyphGeometry,
    node: GlyphNode,
  ) {
    this.id = anchorId;
    this.geometry = geometry;
    this.node = node;
  }

  bounds(): Rect2D | null {
    const anchor = this.geometry.anchor(this.anchorId);
    if (!anchor) return null;

    return Bounds.toRect(Bounds.fromPoint(Vec2.add(this.node.position, anchor)));
  }
}
