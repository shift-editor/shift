import { Vec2, type Point2D } from "@shift/geo";
import type { AnchorId, PointId } from "@shift/types";
import { Transform } from "@/lib/transform/Transform";
import type { GlyphGeometry, SourcePosition, SourcePositions, SourcePositionTarget } from "./Glyph";

export interface SourcePositionSubject {
  readonly points?: readonly PointId[];
  readonly anchors?: readonly AnchorId[];
}

export class SourcePositionList {
  readonly positions: SourcePositions;

  private constructor(positions: SourcePositions) {
    this.positions = [...positions];
  }

  /** @knipclassignore — convenience constructor for draft callers. */
  static empty(): SourcePositionList {
    return new SourcePositionList([]);
  }

  static fromPositions(positions: SourcePositions): SourcePositionList {
    return new SourcePositionList(positions);
  }

  static fromSubject(geometry: GlyphGeometry, subject: SourcePositionSubject): SourcePositionList {
    return SourcePositionList.fromTargets(geometry, SourcePositionList.targetsFromSubject(subject));
  }

  static fromTargets(
    geometry: GlyphGeometry,
    targets: readonly SourcePositionTarget[],
  ): SourcePositionList {
    const positions: SourcePosition[] = [];

    for (const target of targets) {
      switch (target.kind) {
        case "point": {
          const point = geometry.point(target.id);
          if (point) positions.push({ kind: "point", id: point.id, x: point.x, y: point.y });
          break;
        }
        case "anchor": {
          const anchor = geometry.anchor(target.id);
          if (anchor) positions.push({ kind: "anchor", id: anchor.id, x: anchor.x, y: anchor.y });
          break;
        }
      }
    }

    return new SourcePositionList(positions);
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

  includeFromGeometry(geometry: GlyphGeometry, positions: SourcePositions): SourcePositionList {
    const known = new Set(this.positions.map(positionKey));
    const missing = positions.filter((position) => !known.has(positionKey(position)));
    if (missing.length === 0) return this;

    return new SourcePositionList([
      ...this.positions,
      ...SourcePositionList.fromTargets(geometry, missing).positions,
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

function positionKey(position: SourcePositionTarget): string {
  return `${position.kind}:${position.id}`;
}
