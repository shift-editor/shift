import { Bounds, type Bounds as BoundsType, Vec2, type Point2D } from "@shift/geo";
import type { AnchorId, ContourId, GlyphState, GlyphStructure, PointId } from "@shift/types";
import { Anchor } from "./Anchor";
import { Component } from "./Component";
import { Contour, type Point } from "./Contour";

export interface GlyphSidebearings {
  readonly lsb: number | null;
  readonly rsb: number | null;
}

export type GlyphPositionTarget =
  | { readonly kind: "point"; readonly id: PointId }
  | { readonly kind: "anchor"; readonly id: AnchorId };

export type GlyphPosition =
  | { readonly kind: "point"; readonly id: PointId; readonly x: number; readonly y: number }
  | {
      readonly kind: "anchor";
      readonly id: AnchorId;
      readonly x: number;
      readonly y: number;
    };

export type GlyphPositions = readonly GlyphPosition[];

export type PackedPositionUpdates = [
  pointIds?: BigUint64Array | null,
  pointCoords?: Float64Array | null,
  anchorIds?: BigUint64Array | null,
  anchorCoords?: Float64Array | null,
];

export class GlyphStateGeometry {
  readonly structure: GlyphStructure;
  readonly values: Float64Array;

  readonly #contours: readonly Contour[];
  readonly #anchors: readonly Anchor[];
  readonly #components: readonly Component[];

  constructor(structure: GlyphStructure, values: Float64Array) {
    this.structure = structure;
    this.values = values;
    this.#contours = Contour.fromStructure(structure, values);
    this.#anchors = Anchor.fromStructure(structure, values);
    this.#components = Component.fromStructure(structure, values);
  }

  static fromState(state: GlyphState): GlyphStateGeometry {
    return new GlyphStateGeometry(state.structure, state.values);
  }

  get xAdvance(): number {
    return this.values[0] ?? 0;
  }

  get contours(): readonly Contour[] {
    return this.#contours;
  }

  get anchors(): readonly Anchor[] {
    return this.#anchors;
  }

  get components(): readonly Component[] {
    return this.#components;
  }

  get allPoints(): Point[] {
    return this.contours.flatMap((contour) => [...contour.points]);
  }

  get bounds(): BoundsType | null {
    return Bounds.unionAll(this.contours.map((contour) => contour.bounds));
  }

  get sidebearings(): GlyphSidebearings {
    const bounds = Bounds.fromPoints(this.allPoints);
    if (!bounds) return { lsb: null, rsb: null };
    return { lsb: bounds.min.x, rsb: this.xAdvance - bounds.max.x };
  }

  point(pointId: PointId): Point | null {
    return this.allPoints.find((point) => point.id === pointId) ?? null;
  }

  points(pointIds: readonly PointId[]): Point[] {
    const ids = new Set(pointIds);
    return this.allPoints.filter((point) => ids.has(point.id));
  }

  contour(contourId: ContourId): Contour | null {
    return this.contours.find((contour) => contour.id === contourId) ?? null;
  }

  anchor(anchorId: AnchorId): Anchor | null {
    return this.anchors.find((anchor) => anchor.id === anchorId) ?? null;
  }

  positionsFor(targets: readonly GlyphPositionTarget[]): GlyphPosition[] {
    const positions: GlyphPosition[] = [];

    for (const target of targets) {
      switch (target.kind) {
        case "point": {
          const point = this.point(target.id);
          if (point) positions.push({ kind: "point", id: point.id, x: point.x, y: point.y });
          break;
        }
        case "anchor": {
          const anchor = this.anchor(target.id);
          if (anchor) positions.push({ kind: "anchor", id: anchor.id, x: anchor.x, y: anchor.y });
          break;
        }
      }
    }

    return positions;
  }

  withPositionUpdates(updates: GlyphPositions): GlyphStateGeometry {
    if (updates.length === 0) return this;

    const values = new Float64Array(this.values);
    const pointOffsets = Contour.pointValueOffsets(this.structure);
    const anchorOffsets = Anchor.valueOffsets(this.structure);

    for (const update of updates) {
      switch (update.kind) {
        case "point": {
          const offset = pointOffsets.get(update.id);
          if (offset === undefined) break;
          values[offset] = update.x;
          values[offset + 1] = update.y;
          break;
        }
        case "anchor": {
          const offset = anchorOffsets.get(update.id);
          if (offset === undefined) break;
          values[offset] = update.x;
          values[offset + 1] = update.y;
          break;
        }
      }
    }

    return new GlyphStateGeometry(this.structure, values);
  }

  movePositions(positions: GlyphPositions, delta: Point2D): GlyphPosition[] {
    return positions.map((position) => {
      const next = Vec2.add(position, delta);
      return { ...position, x: next.x, y: next.y };
    });
  }

  static packPositionUpdates(updates: GlyphPositions): PackedPositionUpdates {
    const pointIds: bigint[] = [];
    const pointCoords: number[] = [];
    const anchorIds: bigint[] = [];
    const anchorCoords: number[] = [];

    for (const update of updates) {
      switch (update.kind) {
        case "point":
          pointIds.push(BigInt(update.id));
          pointCoords.push(update.x, update.y);
          break;
        case "anchor":
          anchorIds.push(BigInt(update.id));
          anchorCoords.push(update.x, update.y);
          break;
      }
    }

    return [
      pointIds.length > 0 ? BigUint64Array.from(pointIds) : null,
      pointCoords.length > 0 ? Float64Array.from(pointCoords) : null,
      anchorIds.length > 0 ? BigUint64Array.from(anchorIds) : null,
      anchorCoords.length > 0 ? Float64Array.from(anchorCoords) : null,
    ];
  }
}
