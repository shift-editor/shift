import type { Point2D } from "@shift/geo";
import type { GlyphLayerPositionTarget } from "../../model/Glyph";
import {
  PointRuleConstraint,
  PositionEdits,
  PositionReference,
  type MoveEdit,
} from "../../model/positions/index";
import type { PositionFeedback, PositionSelection } from "../../../types/positionEdit";

export class TranslateInteraction {
  readonly move: MoveEdit;
  readonly startPos: Point2D;

  constructor(
    selection: PositionSelection,
    reference: GlyphLayerPositionTarget | null,
    pointerStart: Point2D,
  ) {
    this.move = PositionEdits.fromSelection(selection).move(selection.targets);

    if (reference) {
      switch (reference.kind) {
        case "point":
          this.move.from(PositionReference.point(reference.id));
          break;
        case "anchor":
          this.move.from(PositionReference.anchor(reference.id));
          break;
      }
    }

    const pointIds = selection.targets.points ?? [];
    if (pointIds.length > 0) {
      this.move.constrainedBy(PointRuleConstraint.forSelection(selection.layer.geometry, pointIds));
    }

    this.startPos = pointerStart;
  }

  switchToCopy(): void {}

  preview(delta: Point2D): PositionFeedback {
    return this.move.preview(delta);
  }

  commit(): void {
    this.move.commit();
  }

  discard(): void {
    this.move.discard();
  }
}
