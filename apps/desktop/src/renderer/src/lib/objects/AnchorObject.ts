import { Bounds, Vec2, type Rect2D } from "@shift/geo";
import type { GlyphGeometry } from "@shift/glyph-state";
import type { AnchorId } from "@shift/types";
import { track } from "@/lib/signals";
import type { GlyphLayer } from "@/lib/model/Glyph";
import type { ShiftObjectOf } from "@/types";
import type { GlyphNode } from "@/types/node";

/** Source-neutral anchor resolved in one placed glyph. */
export class AnchorObject implements ShiftObjectOf<"anchor"> {
  readonly kind = "anchor";
  readonly id: AnchorId;
  readonly #geometry: GlyphGeometry;
  readonly layer: GlyphLayer | null;
  readonly node: GlyphNode;

  constructor(
    readonly anchorId: AnchorId,
    geometry: GlyphGeometry,
    node: GlyphNode,
    layer: GlyphLayer | null = null,
  ) {
    this.id = anchorId;
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
    const anchor = this.geometry.anchor(this.anchorId);
    if (!anchor) return null;

    return Bounds.toRect(Bounds.fromPoint(Vec2.add(this.node.position, anchor)));
  }
}
