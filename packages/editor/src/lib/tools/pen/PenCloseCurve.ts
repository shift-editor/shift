import { Vec2, type Point2D } from "@shift/geo";
import { Point } from "@shift/glyph-state";
import type { PointId } from "@shift/types";
import type { GlyphLayerEdit } from "../../model/GlyphLayerEdit";
import { DirectionSnap } from "../../model/positions/index";
import type { PenStroke } from "./PenStroke";
import type { PenClose } from "./types";
import type { PositionGuide } from "../../../types/positionEdit";

/**
 * How the first point's existing outgoing side constrains the closing handle.
 *
 * A curve leaving the first point has a handle that mirrors the dragged one; a
 * line leaving it fixes the tangent, so the drag only sets the handle's length.
 */
type FirstSegmentTangent =
  | { readonly kind: "handle"; readonly handleId: PointId }
  | { readonly kind: "line"; readonly direction: Point2D };

/** One closing cubic previewed while dragging off the active contour's first point. */
export class PenCloseCurve {
  readonly #edit: GlyphLayerEdit;
  readonly #close: PenClose;
  readonly #controlEndId: PointId;
  readonly #tangent: FirstSegmentTangent;

  private constructor(
    edit: GlyphLayerEdit,
    close: PenClose,
    controlEndId: PointId,
    tangent: FirstSegmentTangent,
  ) {
    this.#edit = edit;
    this.#close = close;
    this.#controlEndId = controlEndId;
    this.#tangent = tangent;
  }

  /**
   * Appends the closing cubic's two controls, marks the first point smooth and
   * closes the contour inside one uncommitted edit.
   *
   * @throws {Error} When the stroke has no active contour or its first segment is missing.
   */
  static begin(stroke: PenStroke, close: PenClose): PenCloseCurve {
    const contour = stroke.activeContour;
    if (!contour) throw new Error("cannot close without an active Pen contour");

    const tangent = firstSegmentTangent(contour.points, close.firstPosition);
    if (!tangent) throw new Error("cannot close a contour without a first segment");

    const controlStart =
      close.start.kind === "corner"
        ? Vec2.lerp(close.start.position, close.firstPosition, 1 / 3)
        : close.start.outgoingHandlePosition;

    const edit = stroke.layer.beginEdit();
    try {
      const [, controlEndId] = edit.addPoints(contour.id, [
        Point.offCurve(controlStart),
        Point.offCurve(close.firstPosition),
      ]);
      if (!controlEndId) throw new Error("cannot begin Pen close without its closing controls");

      edit.setPointSmooth(close.firstPointId, true);
      edit.closeContour(contour.id);
      return new PenCloseCurve(edit, close, controlEndId, tangent);
    } catch (error) {
      edit.cancel();
      throw error;
    }
  }

  /**
   * Places the closing handle for a pointer position.
   *
   * @param pointer - Glyph-local pointer position; the drag pulls the first point's outgoing side.
   * @param shiftKey - Snaps the drag direction to 15° steps.
   * @returns A direction guide along the snapped handle, or none when not snapping.
   */
  preview(pointer: Point2D, shiftKey: boolean): readonly PositionGuide[] {
    const anchor = this.#close.firstPosition;
    const rawDrag = Vec2.sub(pointer, anchor);
    const snappedDrag = shiftKey ? DirectionSnap.everyDegrees(15).apply(rawDrag) : null;
    const drag = snappedDrag ?? rawDrag;
    const guides: readonly PositionGuide[] = snappedDrag
      ? [{ kind: "direction", from: anchor, to: Vec2.add(anchor, drag) }]
      : [];

    switch (this.#tangent.kind) {
      case "handle": {
        const outgoing = Vec2.add(anchor, drag);
        const incoming = Vec2.sub(anchor, drag);
        this.#edit.setPositions([
          { kind: "point", id: this.#tangent.handleId, x: outgoing.x, y: outgoing.y },
          { kind: "point", id: this.#controlEndId, x: incoming.x, y: incoming.y },
        ]);
        return guides;
      }
      case "line": {
        const direction = this.#tangent.direction;
        const length = Math.max(0, Vec2.dot(Vec2.negate(drag), direction));
        const incoming = Vec2.add(anchor, Vec2.scale(direction, length));
        this.#edit.setPositions([
          { kind: "point", id: this.#controlEndId, x: incoming.x, y: incoming.y },
        ]);
        return [];
      }
    }
  }

  commit(): void {
    this.#edit.finish("Close contour");
  }

  cancel(): void {
    this.#edit.cancel();
  }
}

/** Unit direction pointing away from the first segment, or the first segment's handle. */
function firstSegmentTangent(
  points: readonly Point[],
  firstPosition: Point2D,
): FirstSegmentTangent | null {
  const next = points[1];
  if (!next) return null;
  if (next.isOffCurve) return { kind: "handle", handleId: next.id };

  const away = Vec2.sub(firstPosition, next.position);
  if (Vec2.len(away) === 0) return null;

  return { kind: "line", direction: Vec2.normalize(away) };
}
