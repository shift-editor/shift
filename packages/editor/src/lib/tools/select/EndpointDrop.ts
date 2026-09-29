import { Vec2, type Point2D } from "@shift/geo";
import type { Contour } from "@shift/glyph-state";
import type { PointId } from "@shift/types";
import type { Editor } from "../../editor/Editor";
import type { GlyphLayer } from "../../model/Glyph";
import type { ContourEnd } from "../../model/JoinContours";
import { objectIsKindOf } from "../../../types/object";

/** A lone selected open end point being dragged, which may land on another open end. */
export class EndpointDrop {
  readonly #layer: GlyphLayer;
  readonly #pointId: PointId;
  readonly #end: ContourEnd;

  private constructor(layer: GlyphLayer, pointId: PointId, end: ContourEnd) {
    this.#layer = layer;
    this.#pointId = pointId;
    this.#end = end;
  }

  /** The drop candidate when the selection is exactly one open end of an open contour. */
  static fromSelection(editor: Editor): EndpointDrop | null {
    const [id, ...rest] = editor.selection.ids;
    if (!id || rest.length > 0) return null;

    const object = editor.object(id);
    if (!objectIsKindOf(object, "point") || !object.layer) return null;

    const contour = object.layer.contour(object.contourId);
    const side = contour ? openEndSide(contour, object.pointId) : null;
    if (!side) return null;

    return new EndpointDrop(object.layer, object.pointId, { contourId: object.contourId, side });
  }

  /** The nearest other open end within `radius` of the dragged end's current position. */
  targetWithin(radius: number): ContourEnd | null {
    const point = this.#layer.point(this.#pointId);
    return point ? this.#nearestOtherEnd(point.position, radius) : null;
  }

  /**
   * Commits the move, then merges the dragged end into `target`, as one undo step.
   *
   * @param commitMove - Commits the drag that carried the end onto `target`.
   * @param target - End found by {@link EndpointDrop.targetWithin} for the same drop.
   * @returns Whether the contours were closed or joined.
   */
  commitAndJoin(commitMove: () => void, target: ContourEnd): boolean {
    return this.#layer.transaction("Join contours", () => {
      commitMove();
      return this.#layer.joinContours(this.#end, target, true);
    });
  }

  #nearestOtherEnd(position: Point2D, radius: number): ContourEnd | null {
    let best: { end: ContourEnd; distance: number } | null = null;

    for (const contour of this.#layer.contours) {
      if (contour.closed) continue;

      for (const point of [contour.firstPoint, contour.lastPoint]) {
        if (!point || point.id === this.#pointId) continue;

        const side = openEndSide(contour, point.id);
        const distance = Vec2.dist(point.position, position);
        if (!side || distance > radius) continue;
        if (best && best.distance <= distance) continue;

        best = { end: { contourId: contour.id, side }, distance };
      }
    }

    return best?.end ?? null;
  }
}

function openEndSide(contour: Contour, pointId: PointId): ContourEnd["side"] | null {
  if (contour.closed) return null;
  if (contour.firstPoint?.id === pointId) return "start";
  if (contour.lastPoint?.id === pointId) return "end";
  return null;
}
