import { Vec2, type Point2D } from "@shift/geo";
import type { AnchorId, PointId } from "@shift/types";
import { Transform } from "@/lib/transform/Transform";
import type { PositionTargets } from "@/types/positionEdit";
import type { GlyphLayerPosition, GlyphLayerPositions, GlyphLayerPositionTarget } from "../Glyph";

export interface PositionLookup {
  positionsFor(targets: readonly GlyphLayerPositionTarget[]): GlyphLayerPosition[];
}

export class PositionList {
  readonly positions: GlyphLayerPositions;
  readonly #pointIds: ReadonlySet<PointId>;
  readonly #anchorIds: ReadonlySet<AnchorId>;

  private constructor(positions: GlyphLayerPositions) {
    this.positions = [...positions];
    const pointIds = new Set<PointId>();
    const anchorIds = new Set<AnchorId>();

    for (const position of positions) {
      switch (position.kind) {
        case "point":
          pointIds.add(position.id);
          break;
        case "anchor":
          anchorIds.add(position.id);
          break;
      }
    }

    this.#pointIds = pointIds;
    this.#anchorIds = anchorIds;
  }

  /** @knipclassignore — convenience constructor for draft callers. */
  static empty(): PositionList {
    return new PositionList([]);
  }

  static fromPositions(positions: GlyphLayerPositions): PositionList {
    return new PositionList(positions);
  }

  static fromTargetGroups(source: PositionLookup, targets: PositionTargets): PositionList {
    return PositionList.fromTargets(source, PositionList.targetListFromGroups(targets));
  }

  static fromTargets(
    source: PositionLookup,
    targets: readonly GlyphLayerPositionTarget[],
  ): PositionList {
    return new PositionList(source.positionsFor(targets));
  }

  static targetListFromGroups(groups: PositionTargets): GlyphLayerPositionTarget[] {
    const targets: GlyphLayerPositionTarget[] = [];
    if (groups.points) {
      targets.push(...groups.points.map((id) => ({ kind: "point" as const, id })));
    }
    if (groups.anchors) {
      targets.push(...groups.anchors.map((id) => ({ kind: "anchor" as const, id })));
    }

    return targets;
  }

  /** @knipclassignore — inverse projection for command/draft callers. */
  get targets(): readonly GlyphLayerPositionTarget[] {
    return this.positions.map((position) => {
      switch (position.kind) {
        case "point":
          return { kind: "point", id: position.id };
        case "anchor":
          return { kind: "anchor", id: position.id };
      }
    });
  }

  includeFrom(source: PositionLookup, positions: GlyphLayerPositions): PositionList {
    let missing: GlyphLayerPositionTarget[] | null = null;

    for (const position of positions) {
      const known =
        position.kind === "point"
          ? this.#pointIds.has(position.id)
          : this.#anchorIds.has(position.id);
      if (known) continue;

      missing ??= [];
      missing.push(position);
    }

    if (!missing) return this;

    return new PositionList([
      ...this.positions,
      ...PositionList.fromTargets(source, missing).positions,
    ]);
  }

  translate(delta: Point2D): PositionList {
    return new PositionList(
      this.positions.map((position) => {
        const next = Vec2.add(position, delta);
        return { ...position, x: next.x, y: next.y };
      }),
    );
  }

  rotate(angle: number, origin: Point2D): PositionList {
    return new PositionList(Transform.rotatePoints(this.positions, angle, origin));
  }

  scale(sx: number, sy: number, origin: Point2D): PositionList {
    return new PositionList(Transform.scalePoints(this.positions, sx, sy, origin));
  }
}
