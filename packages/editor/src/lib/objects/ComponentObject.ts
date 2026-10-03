import { localBounds } from "../editor/spaces";
import type { LocalBounds } from "../../types/coordinates";
import type { ComponentId } from "@shift/types";
import type { ComponentGlyph } from "../model/ComponentGlyph";
import type { GlyphLayer } from "../model/Glyph";
import { track } from "../signals";
import type { ShiftObjectOf } from "../../types/object";
import type { GlyphNode } from "../../types/node";

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

  bounds(): LocalBounds | null {
    track(this.component.boundsCell);
    const bounds = this.component.boundsCell.peek();
    if (!bounds) return null;

    return localBounds(bounds);
  }
}
