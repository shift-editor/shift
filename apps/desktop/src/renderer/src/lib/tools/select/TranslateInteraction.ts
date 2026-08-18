import type { Point2D } from "@shift/geo";
import type { GlyphLayerPositionTarget } from "@/lib/model/Glyph";
import { PointRuleConstraint, PositionReference, type MoveEdit } from "@/lib/model/positions";
import type { PositionSelection } from "@/types/positionEdit";

export class TranslateInteraction {
  readonly #move: MoveEdit;
  readonly startPos: Point2D;

  constructor(
    selection: PositionSelection,
    reference: GlyphLayerPositionTarget | null,
    pointerStart: Point2D,
  ) {
    this.#move = selection.layer.positions.move(selection.targets);

    if (reference) {
      switch (reference.kind) {
        case "point":
          this.#move.from(PositionReference.point(reference.id));
          break;
        case "anchor":
          this.#move.from(PositionReference.anchor(reference.id));
          break;
      }
    }

    const pointIds = selection.targets.points ?? [];
    if (pointIds.length > 0) {
      this.#move.constrainedBy(
        PointRuleConstraint.forSelection(selection.layer.geometry, pointIds),
      );
    }

    this.startPos = pointerStart;
  }

  switchToCopy(): void {}

  preview(delta: Point2D): Point2D {
    return this.#move.preview(delta).delta;
  }

  commit(): void {
    this.#move.commit();
  }

  discard(): void {
    this.#move.discard();
  }
}
