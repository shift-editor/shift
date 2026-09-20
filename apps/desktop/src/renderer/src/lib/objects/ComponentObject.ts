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
  readonly componentId: ComponentId;
  readonly componentPath: readonly ComponentId[];

  constructor(
    readonly component: ComponentGlyph,
    readonly node: GlyphNode,
    readonly layer: GlyphLayer | null = null,
  ) {
    this.id = component.componentId;
    this.componentId = component.componentId;
    this.componentPath = component.componentPath;
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
