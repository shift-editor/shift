import { Bounds, Vec2, type Rect2D } from "@shift/geo";
import type { ContourId, LayerId } from "@shift/types";
import { track } from "@/lib/signals";
import type { GlyphLayer } from "@/lib/model/Glyph";
import type { ShiftObjectOf } from "@/types";
import type { GlyphNode } from "@/types/node";

/**
 * Resolved editable glyph contour in the current scene.
 *
 * @remarks
 * The contour is looked up from the current layer geometry when behavior runs,
 * so replacement structure is observed without storing contour objects here.
 */
export class ContourObject implements ShiftObjectOf<"contour"> {
  readonly kind = "contour";
  readonly id: ContourId;
  readonly layer: GlyphLayer;
  readonly layerId: LayerId;
  readonly node: GlyphNode;
  readonly #contourId: ContourId;

  /**
   * Creates a placed contour object from its canonical layer and scene node.
   *
   * @param contourId - Stable contour identity owned by `layer`.
   * @param layer - Authored glyph layer that owns the contour.
   * @param node - Scene occurrence placing the layer on the canvas.
   */
  constructor(contourId: ContourId, layer: GlyphLayer, node: GlyphNode) {
    this.id = contourId;
    this.#contourId = contourId;
    this.layer = layer;
    this.layerId = layer.id;
    this.node = node;
  }

  /** Stable contour identity owned by this object's layer. */
  get contourId(): ContourId {
    return this.#contourId;
  }

  /**
   * Returns scene-space bounds for the current contour outline.
   *
   * @returns null when the contour no longer exists or has no drawable segments.
   */
  bounds(): Rect2D | null {
    track(this.layer.structureCell);
    track(this.layer.coordinateBuffersChangedCell);

    const contour = this.layer.contour(this.contourId);
    if (!contour) return null;

    const bounds = contour.bounds;
    if (!bounds) return null;

    return Bounds.toRect({
      min: Vec2.add(this.node.position, bounds.min),
      max: Vec2.add(this.node.position, bounds.max),
    });
  }
}
