import { Vec2, type Point2D } from "@shift/geo";
import type { AnchorId, PointId } from "@shift/types";
import { Transform } from "@/lib/transform/Transform";
import type { SourcePosition, SourcePositions, SourcePositionTarget } from "./Glyph";

export interface SourcePositionSubject {
  readonly points?: readonly PointId[];
  readonly anchors?: readonly AnchorId[];
}

export interface SourcePositionLookup {
  positionsFor(targets: readonly SourcePositionTarget[]): SourcePosition[];
}

export class SourcePositionList {
  readonly positions: SourcePositions;
  readonly #pointIds: ReadonlySet<PointId>;
  readonly #anchorIds: ReadonlySet<AnchorId>;

  private constructor(positions: SourcePositions) {
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
  static empty(): SourcePositionList {
    return new SourcePositionList([]);
  }

  static fromPositions(positions: SourcePositions): SourcePositionList {
    return new SourcePositionList(positions);
  }

  static fromSubject(
    source: SourcePositionLookup,
    subject: SourcePositionSubject,
  ): SourcePositionList {
    return SourcePositionList.fromTargets(source, SourcePositionList.targetsFromSubject(subject));
  }

  static fromTargets(
    source: SourcePositionLookup,
    targets: readonly SourcePositionTarget[],
  ): SourcePositionList {
    return new SourcePositionList(source.positionsFor(targets));
  }

  static targetsFromSubject(subject: SourcePositionSubject): SourcePositionTarget[] {
    const targets: SourcePositionTarget[] = [];
    if (subject.points) {
      targets.push(...subject.points.map((id) => ({ kind: "point" as const, id })));
    }
    if (subject.anchors) {
      targets.push(...subject.anchors.map((id) => ({ kind: "anchor" as const, id })));
    }

    return targets;
  }

  /** @knipclassignore — inverse projection for command/draft callers. */
  get targets(): readonly SourcePositionTarget[] {
    return this.positions.map((position) => {
      switch (position.kind) {
        case "point":
          return { kind: "point", id: position.id };
        case "anchor":
          return { kind: "anchor", id: position.id };
      }
    });
  }

  includeFrom(source: SourcePositionLookup, positions: SourcePositions): SourcePositionList {
    let missing: SourcePositionTarget[] | null = null;

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

    return new SourcePositionList([
      ...this.positions,
      ...SourcePositionList.fromTargets(source, missing).positions,
    ]);
  }

  translate(delta: Point2D): SourcePositionList {
    return new SourcePositionList(
      this.positions.map((position) => {
        const next = Vec2.add(position, delta);
        return { ...position, x: next.x, y: next.y };
      }),
    );
  }

  rotate(angle: number, origin: Point2D): SourcePositionList {
    return new SourcePositionList(Transform.rotatePoints(this.positions, angle, origin));
  }

  scale(sx: number, sy: number, origin: Point2D): SourcePositionList {
    return new SourcePositionList(Transform.scalePoints(this.positions, sx, sy, origin));
  }
}
