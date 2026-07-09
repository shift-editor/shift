import { Bounds, Vec2, type Rect2D } from "@shift/geo";
import type { ContourId, LayerId, PointId } from "@shift/types";
import type { SegmentId } from "@shift/glyph-state";
import { track } from "@/lib/signals";
import type { GlyphLayer } from "@/lib/model/Glyph";
import type { ShiftObjectOf } from "@/types";
import type { GlyphNode } from "@/types/node";

/**
 * Resolved editable glyph segment in the current scene.
 *
 * @remarks
 * Segment IDs are derived from endpoint point IDs. `pointIds` preserves the
 * source points associated with this segment so operations can expand segment
 * selection without rewriting selection state.
 */
export class SegmentObject implements ShiftObjectOf<"segment"> {
  readonly kind = "segment";
  readonly id: SegmentId;
  readonly pointIds: readonly PointId[];
  readonly layer: GlyphLayer;
  readonly layerId: LayerId;
  readonly contourId: ContourId;
  readonly node: GlyphNode;
  readonly #segmentId: SegmentId;

  /**
   * Creates a placed segment object from its canonical layer and scene node.
   *
   * @param segmentId - Derived segment identity owned by `layer`.
   * @param contourId - Contour that owns the segment.
   * @param pointIds - Point identities associated with the segment.
   * @param layer - Authored glyph layer that owns the segment.
   * @param node - Scene occurrence placing the layer on the canvas.
   */
  constructor(
    segmentId: SegmentId,
    contourId: ContourId,
    pointIds: readonly PointId[],
    layer: GlyphLayer,
    node: GlyphNode,
  ) {
    this.id = segmentId;
    this.#segmentId = segmentId;
    this.contourId = contourId;
    this.pointIds = pointIds;
    this.layer = layer;
    this.layerId = layer.id;
    this.node = node;
  }

  /** Stable segment identity derived from this object's endpoint points. */
  get segmentId(): SegmentId {
    return this.#segmentId;
  }

  /**
   * Returns scene-space bounds for the current segment curve.
   *
   * @returns null when the segment no longer exists in the layer.
   */
  bounds(): Rect2D | null {
    track(this.layer.structureCell);
    track(this.layer.coordinateBuffersChangedCell);

    const segment = this.layer.segment(this.segmentId);
    if (!segment) return null;

    return Bounds.toRect({
      min: Vec2.add(this.node.position, segment.bounds.min),
      max: Vec2.add(this.node.position, segment.bounds.max),
    });
  }
}
