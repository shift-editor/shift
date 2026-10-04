import { localBounds } from "../editor/spaces";
import type { LocalBounds } from "../../types/coordinates";
import type { GlyphGeometry } from "@shift/glyph-state";
import type { ContourId } from "@shift/types";
import { track } from "../signals/index";
import type { GlyphLayer } from "../model/Glyph";
import type { ShiftObjectOf } from "../../types/object";
import type { GlyphNode } from "../../types/node";

/** Source-neutral contour resolved in one placed glyph. */
export class ContourObject implements ShiftObjectOf<"contour"> {
  readonly kind = "contour";
  readonly id: ContourId;
  readonly #geometry: GlyphGeometry;
  readonly layer: GlyphLayer | null;
  readonly node: GlyphNode;

  constructor(
    readonly contourId: ContourId,
    geometry: GlyphGeometry,
    node: GlyphNode,
    layer: GlyphLayer | null = null,
  ) {
    this.id = contourId;
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
    const bounds = this.geometry.contour(this.contourId)?.bounds;
    if (!bounds) return null;

    return localBounds(bounds);
  }
}
