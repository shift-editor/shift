import type { GlyphGeometry } from "@shift/glyph-state";
import type { ContourId, PointId, SegmentId } from "@shift/types";
import type { LocalBounds } from "../../types/coordinates";
import { localBounds } from "../editor/spaces";
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

  bounds(): LocalBounds | null {
    const segment = this.geometry.segment(this.segmentId);
    if (!segment) return null;

    return localBounds(segment.bounds);
  }
}
