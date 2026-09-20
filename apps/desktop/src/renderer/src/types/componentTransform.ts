import type { Rect2D } from "@shift/geo";
import type { ComponentId } from "@shift/types";
import type { GlyphLayer } from "@/lib/model/Glyph";

/** Direct component identities and resolved local bounds for one authored layer. */
export interface ComponentTransformSelectionLayer {
  readonly layer: GlyphLayer;
  readonly componentIds: readonly ComponentId[];
  readonly bounds: Rect2D;
}

/** Reference component selection and its completely matched source layers. */
export interface ComponentTransformSelection extends ComponentTransformSelectionLayer {
  readonly additionalLayers: readonly ComponentTransformSelectionLayer[];
}
