import type { Point2D } from "@shift/geo";
import type { GlyphLayerPositionTarget } from "../../model/Glyph";
import {
  PointRuleConstraint,
  PositionEdits,
  PositionReference,
  type MoveEdit,
} from "../../model/positions/index";
import type { PositionFeedback, PositionSelection } from "../../../types/positionEdit";
import type { PointSlide } from "./PointSlide";

export class TranslateInteraction {
  readonly move: MoveEdit;
  readonly selection: PositionSelection;
  readonly startPos: Point2D;

  constructor(
    selection: PositionSelection,
    reference: GlyphLayerPositionTarget | null,
    pointerStart: Point2D,
    slide: PointSlide | null = null,
  ) {
    this.selection = selection;
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

    if (slide) this.move.along(slide.axis);

    const pointIds = selection.targets.points ?? [];
    const handlesFollow = slide?.handlesFollow ?? true;
    if (pointIds.length > 0 && handlesFollow) {
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
