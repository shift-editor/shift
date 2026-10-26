import { Vec2, type Point2D } from "@shift/geo";
import type { AnchorId, PointId, PointType } from "@shift/types";
import { releaseDrag } from "@shift/wasm";
import { dragMoves, prepareDrag } from "../../wasm/generated/layouts";
import type { GlyphLayerPositions } from "../Glyph";

/** A layer's contours as a drag's rules read them: each contour's points in order. */
export interface PointRuleGeometry {
  readonly contours: readonly {
    readonly closed: boolean;
    readonly points: readonly {
      readonly id: PointId;
      readonly x: number;
      readonly y: number;
      readonly pointType: PointType;
      readonly smooth: boolean;
    }[];
  }[];
}

const released = new FinalizationRegistry<number>(releaseDrag);

/**
 * shift-font's drag rules for one selection, applied after movement snapping:
 * handles follow their anchors and smooth points stay smooth.
 *
 * @remarks
 * The rules are matched once, in `@shift/wasm`, when the selection is
 * prepared ({@link PointRuleConstraint.forSelection}); each frame then sends
 * only the drag delta. {@link PointRuleConstraint.dispose} releases the
 * prepared drag; it is also released when this object is collected.
 */
export class PointRuleConstraint {
  readonly #handle: number;
  /** Each point id in the layer's flat point order, contour after contour. */
  readonly #pointIds: readonly PointId[];
  #disposed = false;

  private constructor(handle: number, pointIds: readonly PointId[]) {
    this.#handle = handle;
    this.#pointIds = pointIds;
    released.register(this, handle, this);
  }

  static forSelection(
    geometry: PointRuleGeometry,
    pointIds: readonly PointId[],
  ): PointRuleConstraint {
    const order: PointId[] = [];
    const indexOf = new Map<PointId, number>();
    const contours = geometry.contours.map((contour) => ({
      closed: contour.closed,
      points: contour.points.map((point) => {
        indexOf.set(point.id, order.length);
        order.push(point.id);
        return { x: point.x, y: point.y, pointType: point.pointType, smooth: point.smooth };
      }),
    }));
    const selected = pointIds.flatMap((id) => {
      const index = indexOf.get(id);
      return index === undefined ? [] : [index];
    });
    const { handle } = prepareDrag({ contours, selected });
    return new PointRuleConstraint(handle, order);
  }

  /**
   * The positions the selection and the points its rules move take for a
   * drag `delta` from where the drag started, with the selected anchors of
   * `base` moved by `delta`.
   *
   * @throws When the constraint was disposed.
   */
  positionsFor(
    base: GlyphLayerPositions,
    anchorIds: readonly AnchorId[],
    delta: Point2D,
  ): GlyphLayerPositions {
    if (this.#disposed) throw new Error("a disposed point rule constraint moves nothing");

    const positions: GlyphLayerPositions[number][] = [];
    for (const move of dragMoves({ handle: this.#handle, dx: delta.x, dy: delta.y })) {
      const id = this.#pointIds[move.point];
      if (id) positions.push({ kind: "point", id, x: move.x, y: move.y });
    }

    const anchors = new Set(anchorIds);
    for (const position of base) {
      if (position.kind !== "anchor" || !anchors.has(position.id)) continue;

      const next = Vec2.add(position, delta);
      positions.push({ ...position, x: next.x, y: next.y });
    }

    return positions;
  }

  /** Releases the prepared drag; the constraint moves nothing afterwards. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    released.unregister(this);
    releaseDrag(this.#handle);
  }
}
