import { Bounds } from "@shift/geo";
import { localBounds } from "../editor/spaces";
import type { LocalBounds } from "../../types/coordinates";
import type { GlyphGeometry } from "@shift/glyph-state";
import type { AnchorId } from "@shift/types";
import { track } from "../signals/index";
import type { GlyphLayer } from "../model/Glyph";
import type { ShiftObjectOf } from "../../types/object";
import type { GlyphNode } from "../../types/node";

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

  bounds(): LocalBounds | null {
    const anchor = this.geometry.anchor(this.anchorId);
    if (!anchor) return null;

    return localBounds(Bounds.fromPoint(anchor));
  }
}
