import { Vec2, type Point2D } from "@shift/geo";
import type { AnchorId, PointId } from "@shift/types";
import {
  constrainPreparedDrag,
  prepareConstrainedDrag,
  type ConstrainDragGlyph,
  type PreparedConstrainDrag,
} from "@shift/rules";
import type { GlyphLayerPositions } from "../Glyph";

/** Prepared point-neighborhood rules applied after movement snapping. */
export class PointRuleConstraint {
  readonly #rules: PreparedConstrainDrag;

  private constructor(rules: PreparedConstrainDrag) {
    this.#rules = rules;
  }

  static forSelection(
    geometry: ConstrainDragGlyph,
    pointIds: readonly PointId[],
  ): PointRuleConstraint {
    return new PointRuleConstraint(prepareConstrainedDrag(geometry, new Set(pointIds)));
  }

  positionsFor(
    base: GlyphLayerPositions,
    anchorIds: readonly AnchorId[],
    delta: Point2D,
  ): GlyphLayerPositions {
    const positions: GlyphLayerPositions[number][] = [];
    const patch = constrainPreparedDrag(this.#rules, delta, {
      includeMatchedRules: false,
    });

    for (const point of patch.pointUpdates) {
      positions.push({ kind: "point", id: point.id, x: point.x, y: point.y });
    }

    const anchors = new Set(anchorIds);
    for (const position of base) {
      if (position.kind !== "anchor" || !anchors.has(position.id)) continue;

      const next = Vec2.add(position, delta);
      positions.push({ ...position, x: next.x, y: next.y });
    }

    return positions;
  }
}
