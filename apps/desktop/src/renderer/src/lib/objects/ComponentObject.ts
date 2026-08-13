import { Bounds, Vec2, type Rect2D } from "@shift/geo";
import type { ComponentId } from "@shift/types";
import type { ComponentGlyph } from "@/lib/model/ComponentGlyph";
import type { GlyphLayer } from "@/lib/model/Glyph";
import { track } from "@/lib/signals";
import type { ShiftObjectOf } from "@/types";
import type { GlyphNode } from "@/types/node";

/** Direct component occurrence resolved in one placed glyph. */
export class ComponentObject implements ShiftObjectOf<"component"> {
  readonly kind = "component";
  readonly id: ComponentId;
  readonly component: ComponentGlyph;
  readonly layer: GlyphLayer | null;
  readonly node: GlyphNode;

  constructor(
    readonly componentId: ComponentId,
    component: ComponentGlyph,
    node: GlyphNode,
    layer: GlyphLayer | null = null,
  ) {
    this.id = componentId;
    this.component = component;
    this.layer = layer;
    this.node = node;
  }

  bounds(): Rect2D | null {
    track(this.component.boundsCell);
    const bounds = this.component.boundsCell.peek();
    if (!bounds) return null;

    return Bounds.toRect({
      min: Vec2.add(this.node.position, bounds.min),
      max: Vec2.add(this.node.position, bounds.max),
    });
  }
}
