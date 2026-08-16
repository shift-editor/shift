import type { Point2D } from "@shift/geo";
import type { GlyphLayer } from "../Glyph";
import type { PositionTargets } from "@/types/positionEdit";
import { MoveEdit } from "./MoveEdit";
import { RotateEdit } from "./RotateEdit";

/** Operation-specific fluent position edits for one authored glyph layer. */
export class LayerPositions {
  readonly #layer: GlyphLayer;

  constructor(layer: GlyphLayer) {
    this.#layer = layer;
  }

  move(targets: PositionTargets): MoveEdit {
    return new MoveEdit(this.#layer, targets);
  }

  rotate(targets: PositionTargets, origin: Point2D): RotateEdit {
    return new RotateEdit(this.#layer, targets, origin);
  }
}
