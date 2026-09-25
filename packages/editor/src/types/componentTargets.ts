import type { ComponentId } from "@shift/types";
import type { GlyphLayer } from "../lib/model/Glyph";

/** Component occurrences targeted in one authored layer. */
export interface ComponentLayerTargets {
  readonly layer: GlyphLayer;
  readonly componentIds: readonly ComponentId[];
}

/** Corresponding component targets across the selected editing sources. */
export interface ComponentTargets extends ComponentLayerTargets {
  readonly additionalLayers: readonly ComponentLayerTargets[];
}
