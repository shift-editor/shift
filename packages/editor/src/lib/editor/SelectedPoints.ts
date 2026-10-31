import { Bounds, Mat, type Bounds as BoundsType, type MatModel } from "@shift/geo";
import type { SelectableId } from "@shift/types";
import type { ContourBuffer } from "../model/ContourBuffer";
import type { GlyphLayer } from "../model/Glyph";
import { track } from "../signals/signal";
import type { ShiftNode } from "../../types/node";

/** A contour buffer and the indices of the selected points in it. */
interface ContourSelection {
  readonly contour: ContourBuffer;
  readonly indices: Uint32Array;
}

/**
 * A selection made only of points in one authored layer, held as indices into
 * that layer's contour buffers.
 *
 * @remarks
 * The selection's bounds are read on every frame of a drag, so they come
 * straight from the packed coordinates rather than from an object resolved
 * per selected point: with 50K points selected that resolution took about a
 * third of each frame. Resolve again when the selection or the layer's
 * structure changes.
 */
export class SelectedPoints {
  /** The selected ids this was resolved from, in selection order. */
  readonly ids: readonly SelectableId[];
  /** The node the layer is placed in. */
  readonly node: ShiftNode;
  readonly #contours: readonly ContourSelection[];

  private constructor(
    ids: readonly SelectableId[],
    node: ShiftNode,
    contours: readonly ContourSelection[],
  ) {
    this.ids = ids;
    this.node = node;
    this.#contours = contours;
  }

  /** @returns `null` unless every id is a point of `layer`. */
  static resolve(
    ids: readonly SelectableId[],
    layer: GlyphLayer,
    node: ShiftNode,
  ): SelectedPoints | null {
    const contours = layer.buffers.contoursCell.peek();
    const placeOf = new Map<SelectableId, { contour: number; index: number }>();
    for (const [contour, buffer] of contours.entries()) {
      for (const [index, point] of buffer.data.points.entries()) {
        placeOf.set(point.id, { contour, index });
      }
    }

    const indices = contours.map((): number[] => []);
    for (const id of ids) {
      const place = placeOf.get(id);
      if (!place) return null;
      indices[place.contour]!.push(place.index);
    }

    const selected = contours
      .entries()
      .filter(([contour]) => indices[contour]!.length > 0)
      .map(([contour, buffer]) => ({
        contour: buffer,
        indices: Uint32Array.from(indices[contour]!),
      }))
      .toArray();
    return new SelectedPoints(ids, node, selected);
  }

  /** Whether `ids` are this selection's ids, in the same order. */
  matches(ids: readonly SelectableId[]): boolean {
    if (ids === this.ids) return true;
    if (ids.length !== this.ids.length) return false;
    return ids.every((id, index) => id === this.ids[index]);
  }

  /**
   * The box around the selected points, each mapped by `matrix` when given;
   * tracks their coordinates.
   */
  bounds(matrix: MatModel | null = null): BoundsType | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const include = (x: number, y: number) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };

    for (const { contour, indices } of this.#contours) {
      track(contour.valuesCell);
      contour.visitPositions(
        indices,
        matrix
          ? (x, y) => {
              const point = Mat.applyToPoint(matrix, { x, y });
              include(point.x, point.y);
            }
          : include,
      );
    }

    if (minX === Infinity) return null;
    return Bounds.create({ x: minX, y: minY }, { x: maxX, y: maxY });
  }
}
