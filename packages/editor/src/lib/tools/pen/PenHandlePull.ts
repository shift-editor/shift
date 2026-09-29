import { Vec2, type Point2D } from "@shift/geo";
import type { Contour } from "@shift/glyph-state";
import type { PointId } from "@shift/types";
import type { GlyphLayerEdit } from "../../model/GlyphLayerEdit";
import { DirectionSnap } from "../../model/positions/index";
import type { PenStroke } from "./PenStroke";
import type { PenEndpoint, PenPull } from "./types";
import type { PositionGuide } from "../../../types/positionEdit";

/**
 * The segment arriving at the pulled end, which decides how the pulled handle behaves.
 *
 * A curve's incoming handle mirrors the pulled one; a line lets the handle move
 * freely, or along the line's direction when constrained; a lone point has nothing
 * to follow.
 */
type IncomingSegment =
  | { readonly kind: "none" }
  | { readonly kind: "line"; readonly direction: Point2D }
  | { readonly kind: "curve"; readonly handleId: PointId };

/** The next segment's first handle pulled out of the active contour's end. */
export class PenHandlePull {
  readonly #stroke: PenStroke;
  readonly #pull: PenPull;
  readonly #incoming: IncomingSegment;
  #edit: GlyphLayerEdit | null = null;
  #handle: Point2D | null = null;
  #smooth = false;

  private constructor(stroke: PenStroke, pull: PenPull, incoming: IncomingSegment) {
    this.#stroke = stroke;
    this.#pull = pull;
    this.#incoming = incoming;
  }

  /**
   * Starts a pull from the active contour's last point.
   *
   * @throws {Error} When the stroke has no active contour.
   */
  static begin(stroke: PenStroke, pull: PenPull): PenHandlePull {
    const contour = stroke.activeContour;
    if (!contour) throw new Error("cannot pull a handle without an active Pen contour");

    return new PenHandlePull(stroke, pull, incomingSegment(contour, pull.position));
  }

  /**
   * Places the pulled handle for a pointer position; a curve's incoming handle mirrors it.
   *
   * @param pointer - Glyph-local pointer position.
   * @param shiftKey - Snaps the drag direction to 15° steps.
   * @param altKey - Keeps a handle pulled from a line on the line's direction.
   * @returns A direction guide along the snapped handle, or none when not snapping.
   */
  preview(pointer: Point2D, shiftKey: boolean, altKey: boolean): readonly PositionGuide[] {
    const anchor = this.#pull.position;
    const rawDrag = Vec2.sub(pointer, anchor);
    const snappedDrag = shiftKey ? DirectionSnap.everyDegrees(15).apply(rawDrag) : null;
    const drag = snappedDrag ?? rawDrag;
    const guides: readonly PositionGuide[] = snappedDrag
      ? [{ kind: "direction", from: anchor, to: Vec2.add(anchor, drag) }]
      : [];

    switch (this.#incoming.kind) {
      case "none":
        this.#handle = Vec2.add(anchor, drag);
        this.#smooth = false;
        return guides;
      case "line": {
        if (!altKey) {
          this.#handle = Vec2.add(anchor, drag);
          this.#smooth = false;
          return guides;
        }

        const direction = this.#incoming.direction;
        const length = Math.max(0, Vec2.dot(rawDrag, direction));
        this.#handle = Vec2.add(anchor, Vec2.scale(direction, length));
        this.#smooth = true;
        return [];
      }
      case "curve": {
        this.#handle = Vec2.add(anchor, drag);
        this.#smooth = true;
        const incoming = Vec2.sub(anchor, drag);
        this.#beginEdit().setPositions([
          { kind: "point", id: this.#incoming.handleId, x: incoming.x, y: incoming.y },
        ]);
        return guides;
      }
    }
  }

  /** The pulled handle's current position; null before the first preview. */
  get handlePosition(): Point2D | null {
    return this.#handle;
  }

  /** Commits the mirrored incoming handle and makes the handle the stroke's next outgoing one. */
  commit(): void {
    const handle = this.#handle;
    if (!handle) {
      this.cancel();
      return;
    }

    this.#edit?.finish("Pull handle");
    const endpoint: PenEndpoint = {
      kind: this.#smooth ? "smooth" : "cusp",
      pointId: this.#pull.pointId,
      position: this.#pull.position,
      outgoingHandlePosition: handle,
    };
    this.#stroke.setActiveEndpoint(endpoint);
  }

  cancel(): void {
    this.#edit?.cancel();
  }

  #beginEdit(): GlyphLayerEdit {
    if (this.#edit) return this.#edit;

    const edit = this.#stroke.layer.beginEdit();
    edit.setPointSmooth(this.#pull.pointId, true);
    this.#edit = edit;
    return edit;
  }
}

/** Describes the segment arriving at the contour's last point, or none for a lone point. */
function incomingSegment(contour: Contour, endPosition: Point2D): IncomingSegment {
  const previous = contour.points.at(-2);
  if (!previous) return { kind: "none" };
  if (previous.isOffCurve) return { kind: "curve", handleId: previous.id };

  const along = Vec2.sub(endPosition, previous.position);
  if (Vec2.len(along) === 0) return { kind: "none" };

  return { kind: "line", direction: Vec2.normalize(along) };
}
