import type {
  AnchorId,
  FontIntent,
  GlyphState,
  MoveAnchorsIntent,
  MovePointsIntent,
  PointId,
  SetXAdvanceIntent,
  TranslatePointsIntent,
} from "@shift/types";
import type { GlyphPosition } from "@shift/glyph-state";

/** Numeric-only local reduction that preserves sparse layer invalidation. */
export class LayerPatchDraft {
  readonly #state: GlyphState;
  readonly #points = new Map<PointId, GlyphPosition>();
  readonly #anchors = new Map<AnchorId, GlyphPosition>();

  xAdvance: number | null = null;

  constructor(state: GlyphState) {
    this.#state = state;
  }

  get positions(): GlyphPosition[] {
    return [...this.#points.values(), ...this.#anchors.values()];
  }

  apply(intent: FontIntent): boolean {
    switch (intent.kind) {
      case "movePoints":
        return intent.movePoints ? this.#movePoints(intent.movePoints) : false;
      case "moveAnchors":
        return intent.moveAnchors ? this.#moveAnchors(intent.moveAnchors) : false;
      case "translatePoints":
        return intent.translatePoints ? this.#translatePoints(intent.translatePoints) : false;
      case "setXAdvance":
        return intent.setXAdvance ? this.#setXAdvance(intent.setXAdvance) : false;
      default:
        return false;
    }
  }

  #movePoints(intent: MovePointsIntent): boolean {
    if (intent.coords.length !== intent.pointIds.length * 2) return false;
    if (intent.pointIds.some((pointId) => this.#pointPosition(pointId) === null)) return false;

    for (let index = 0; index < intent.pointIds.length; index++) {
      const id = intent.pointIds[index];
      this.#points.set(id, {
        kind: "point",
        id,
        x: intent.coords[index * 2] ?? 0,
        y: intent.coords[index * 2 + 1] ?? 0,
      });
    }

    return true;
  }

  #moveAnchors(intent: MoveAnchorsIntent): boolean {
    if (intent.coords.length !== intent.anchorIds.length * 2) return false;
    if (intent.anchorIds.some((anchorId) => this.#anchorPosition(anchorId) === null)) return false;

    for (let index = 0; index < intent.anchorIds.length; index++) {
      const id = intent.anchorIds[index];
      this.#anchors.set(id, {
        kind: "anchor",
        id,
        x: intent.coords[index * 2] ?? 0,
        y: intent.coords[index * 2 + 1] ?? 0,
      });
    }

    return true;
  }

  #translatePoints(intent: TranslatePointsIntent): boolean {
    const pointIds = [...new Set(intent.pointIds)];
    const positions = pointIds.map((pointId) => this.#pointPosition(pointId));
    if (positions.some((position) => position === null)) return false;

    for (let index = 0; index < pointIds.length; index++) {
      const position = positions[index];
      if (!position) return false;

      this.#points.set(pointIds[index], {
        ...position,
        x: position.x + intent.dx,
        y: position.y + intent.dy,
      });
    }

    return true;
  }

  #setXAdvance(intent: SetXAdvanceIntent): boolean {
    this.xAdvance = intent.width;
    return true;
  }

  #pointPosition(pointId: PointId): GlyphPosition | null {
    const pending = this.#points.get(pointId);
    if (pending) return pending;

    let valueOffset = 1;
    for (const contour of this.#state.structure.contours) {
      for (const point of contour.points) {
        if (point.id === pointId) {
          return {
            kind: "point",
            id: pointId,
            x: this.#state.values[valueOffset] ?? 0,
            y: this.#state.values[valueOffset + 1] ?? 0,
          };
        }
        valueOffset += 2;
      }
    }

    return null;
  }

  #anchorPosition(anchorId: AnchorId): GlyphPosition | null {
    const pending = this.#anchors.get(anchorId);
    if (pending) return pending;

    let valueOffset = 1;
    for (const contour of this.#state.structure.contours) {
      valueOffset += contour.points.length * 2;
    }

    for (const anchor of this.#state.structure.anchors) {
      if (anchor.id === anchorId) {
        return {
          kind: "anchor",
          id: anchorId,
          x: this.#state.values[valueOffset] ?? 0,
          y: this.#state.values[valueOffset + 1] ?? 0,
        };
      }
      valueOffset += 2;
    }

    return null;
  }
}
