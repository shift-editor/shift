import { Bounds, Vec2, type Rect2D } from "@shift/geo";
import type { ContourId, LayerId, PointId } from "@shift/types";
import { track } from "@/lib/signals";
import type { GlyphLayer } from "@/lib/model/Glyph";
import type { ShiftObjectOf } from "@/types";
import type { GlyphNode } from "@/types/node";

/**
 * Resolved editable glyph point in the current scene.
 *
 * @remarks
 * The point is read from `layer` each time behavior runs. `node` supplies the
 * scene placement for that glyph layer, so bounds are returned in scene space
 * rather than glyph-local space.
 */
export class PointObject implements ShiftObjectOf<"point"> {
  readonly kind = "point";
  readonly id: PointId;
  readonly layer: GlyphLayer;
  readonly layerId: LayerId;
  readonly contourId: ContourId;
  readonly node: GlyphNode;
  readonly #pointId: PointId;

  /**
   * Creates a placed point object from its canonical layer and scene node.
   *
   * @param pointId - Stable point identity owned by `layer`.
   * @param contourId - Contour that owns the point.
   * @param layer - Authored glyph layer that owns the point.
   * @param node - Scene occurrence placing the layer on the canvas.
   */
  constructor(pointId: PointId, contourId: ContourId, layer: GlyphLayer, node: GlyphNode) {
    this.id = pointId;
    this.#pointId = pointId;
    this.contourId = contourId;
    this.layer = layer;
    this.layerId = layer.id;
    this.node = node;
  }

  /** Stable point identity owned by this object's layer. */
  get pointId(): PointId {
    return this.#pointId;
  }

  /**
   * Returns zero-area scene-space bounds for the current point position.
   *
   * @returns null when the point no longer exists in the layer.
   */
  bounds(): Rect2D | null {
    track(this.layer.structureCell);
    track(this.layer.coordinateBuffersChangedCell);

    const point = this.layer.point(this.pointId);
    if (!point) return null;

    return Bounds.toRect(Bounds.fromPoint(Vec2.add(this.node.position, point)));
  }
}
