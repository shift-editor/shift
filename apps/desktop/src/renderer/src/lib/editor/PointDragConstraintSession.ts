import type { Point2D, PointId, GlyphSnapshot } from "@shift/types";
import {
  constrainPreparedDrag,
  prepareConstrainDrag,
  type PreparedConstrainDrag,
} from "@shift/rules";
import type { NodePositionUpdateList } from "@/types/positionUpdate";

export class PointDragConstraintSession {
  #prepared: PreparedConstrainDrag;

  private constructor(prepared: PreparedConstrainDrag) {
    this.#prepared = prepared;
  }

  static prepare(
    glyph: GlyphSnapshot,
    selectedPointIds: readonly PointId[],
  ): PointDragConstraintSession | null {
    if (selectedPointIds.length === 0) return null;
    return new PointDragConstraintSession(prepareConstrainDrag(glyph, new Set(selectedPointIds)));
  }

  constrain(pointerDelta: Point2D): NodePositionUpdateList {
    const patch = constrainPreparedDrag(this.#prepared, pointerDelta, {
      includeMatchedRules: false,
    });

    return patch.pointUpdates.map((update) => ({
      node: { kind: "point" as const, id: update.id },
      x: update.x,
      y: update.y,
    }));
  }

  allowsUniformTranslationCommit(): boolean {
    return this.#prepared.matchedRules.length === 0;
  }
}
