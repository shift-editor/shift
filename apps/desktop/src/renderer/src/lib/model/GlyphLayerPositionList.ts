import { Vec2, type Point2D } from "@shift/geo";
import type { AnchorId, PointId } from "@shift/types";
import { Transform } from "@/lib/transform/Transform";
import type { GlyphLayerPosition, GlyphLayerPositions, GlyphLayerPositionTarget } from "./Glyph";

export interface GlyphLayerPositionSubject {
  readonly points?: readonly PointId[];
  readonly anchors?: readonly AnchorId[];
}

export interface GlyphLayerPositionLookup {
  positionsFor(targets: readonly GlyphLayerPositionTarget[]): GlyphLayerPosition[];
}

export class GlyphLayerPositionList {
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
  static empty(): GlyphLayerPositionList {
    return new GlyphLayerPositionList([]);
  }

  static fromPositions(positions: GlyphLayerPositions): GlyphLayerPositionList {
    return new GlyphLayerPositionList(positions);
  }

  static fromSubject(
    source: GlyphLayerPositionLookup,
    subject: GlyphLayerPositionSubject,
  ): GlyphLayerPositionList {
    return GlyphLayerPositionList.fromTargets(
      source,
      GlyphLayerPositionList.targetsFromSubject(subject),
    );
  }

  static fromTargets(
    source: GlyphLayerPositionLookup,
    targets: readonly GlyphLayerPositionTarget[],
  ): GlyphLayerPositionList {
    return new GlyphLayerPositionList(source.positionsFor(targets));
  }

  static targetsFromSubject(subject: GlyphLayerPositionSubject): GlyphLayerPositionTarget[] {
    const targets: GlyphLayerPositionTarget[] = [];
    if (subject.points) {
      targets.push(...subject.points.map((id) => ({ kind: "point" as const, id })));
    }
    if (subject.anchors) {
      targets.push(...subject.anchors.map((id) => ({ kind: "anchor" as const, id })));
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

  includeFrom(
    source: GlyphLayerPositionLookup,
    positions: GlyphLayerPositions,
  ): GlyphLayerPositionList {
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

    return new GlyphLayerPositionList([
      ...this.positions,
      ...GlyphLayerPositionList.fromTargets(source, missing).positions,
    ]);
  }

  translate(delta: Point2D): GlyphLayerPositionList {
    return new GlyphLayerPositionList(
      this.positions.map((position) => {
        const next = Vec2.add(position, delta);
        return { ...position, x: next.x, y: next.y };
      }),
    );
  }

  rotate(angle: number, origin: Point2D): GlyphLayerPositionList {
    return new GlyphLayerPositionList(Transform.rotatePoints(this.positions, angle, origin));
  }

  scale(sx: number, sy: number, origin: Point2D): GlyphLayerPositionList {
    return new GlyphLayerPositionList(Transform.scalePoints(this.positions, sx, sy, origin));
  }
}
