import { Bounds, Vec2, type Rect2D } from "@shift/geo";
import type { AnchorId, LayerId } from "@shift/types";
import { track } from "@/lib/signals";
import type { GlyphLayer } from "@/lib/model/Glyph";
import type { ShiftObjectOf } from "@/types";
import type { GlyphNode } from "@/types/node";

/**
 * Resolved editable glyph anchor in the current scene.
 *
 * @remarks
 * The anchor is read from `layer` each time behavior runs. `node` supplies the
 * scene placement for the authored glyph layer.
 */
export class AnchorObject implements ShiftObjectOf<"anchor"> {
  readonly kind = "anchor";
  readonly id: AnchorId;
  readonly layer: GlyphLayer;
  readonly layerId: LayerId;
  readonly node: GlyphNode;
  readonly #anchorId: AnchorId;

  /**
   * Creates a placed anchor object from its canonical layer and scene node.
   *
   * @param anchorId - Stable anchor identity owned by `layer`.
   * @param layer - Authored glyph layer that owns the anchor.
   * @param node - Scene occurrence placing the layer on the canvas.
   */
  constructor(anchorId: AnchorId, layer: GlyphLayer, node: GlyphNode) {
    this.id = anchorId;
    this.#anchorId = anchorId;
    this.layer = layer;
    this.layerId = layer.id;
    this.node = node;
  }

  /** Stable anchor identity owned by this object's layer. */
  get anchorId(): AnchorId {
    return this.#anchorId;
  }

  /**
   * Returns zero-area scene-space bounds for the current anchor position.
   *
   * @returns null when the anchor no longer exists in the layer.
   */
  bounds(): Rect2D | null {
    track(this.layer.structureCell);
    track(this.layer.coordinateBuffersChangedCell);

    const anchor = this.layer.anchor(this.anchorId);
    if (!anchor) return null;

    return Bounds.toRect(Bounds.fromPoint(Vec2.add(this.node.position, anchor)));
  }
}
