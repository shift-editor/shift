/**
 * Scale bezier handle lengths command.
 *
 * Scales selected off-curve (control) points by adjusting their distance
 * from their parent anchor point while preserving direction.
 *
 * Algorithm:
 * 1. For each selected off-curve point, find its anchor (adjacent on-curve point)
 * 2. Calculate the vector from anchor to handle
 * 3. Scale the vector's magnitude by adding the delta
 * 4. Move handle to the new position
 *
 * Only affects off-curve points. On-curve points in the selection are ignored.
 */

import type { PointId, Glyph, Point2D, Point } from "@shift/types";
import { asPointId } from "@shift/types";
import { Vec2 } from "@shift/geo";
import { BaseCommand, type CommandContext } from "../core/Command";

interface HandleMove {
  pointId: PointId;
  newPos: Point2D;
  originalPos: Point2D;
}

const EPSILON = 1e-10;
const MIN_HANDLE_LENGTH = 1; // Minimum handle length to prevent collapse

export class ScaleHandlesCommand extends BaseCommand<void> {
  readonly name = "Scale Handles";

  #glyph: Glyph;
  #pointIds: PointId[];
  #scaleDelta: number;
  #moves: HandleMove[] = [];

  constructor(glyph: Glyph, pointIds: PointId[], scaleDelta: number) {
    super();
    this.#glyph = glyph;
    this.#pointIds = [...pointIds];
    this.#scaleDelta = scaleDelta;
  }

  execute(ctx: CommandContext): void {
    this.#moves = this.#calculateMoves();

    if (this.#moves.length === 0) return;

    // Apply all moves
    for (const move of this.#moves) {
      ctx.fontEngine.editing.movePointTo(move.pointId, move.newPos.x, move.newPos.y);
    }
  }

  undo(ctx: CommandContext): void {
    // Restore original positions
    for (const move of this.#moves) {
      ctx.fontEngine.editing.movePointTo(move.pointId, move.originalPos.x, move.originalPos.y);
    }
  }

  redo(ctx: CommandContext): void {
    // Re-apply moves
    for (const move of this.#moves) {
      ctx.fontEngine.editing.movePointTo(move.pointId, move.newPos.x, move.newPos.y);
    }
  }

  #calculateMoves(): HandleMove[] {
    const moves: HandleMove[] = [];
    const selectedSet = new Set(this.#pointIds.map((id) => String(id)));

    for (const contour of this.#glyph.contours) {
      const points = contour.points;
      const len = points.length;

      for (let i = 0; i < len; i++) {
        const point = points[i];
        const pointId = asPointId(point.id);

        // Skip if not selected or not an off-curve point
        if (!selectedSet.has(point.id) || point.pointType !== "offCurve") {
          continue;
        }

        // Find the anchor point for this handle
        const anchor = this.#findAnchor(points, i, contour.closed);
        if (!anchor) continue;

        // Calculate new position
        const newPos = this.#scaleHandle(point, anchor);
        if (!newPos) continue;

        moves.push({
          pointId,
          newPos,
          originalPos: { x: point.x, y: point.y },
        });
      }
    }

    return moves;
  }

  /**
   * Find the anchor (on-curve point) for an off-curve handle.
   *
   * For a cubic segment: anchor1 - control1 - control2 - anchor2
   * - control1's anchor is anchor1 (previous on-curve)
   * - control2's anchor is anchor2 (next on-curve)
   *
   * For a quadratic segment: anchor1 - control - anchor2
   * - control's anchor is anchor1 (previous on-curve)
   */
  #findAnchor(
    points: readonly Point[],
    handleIndex: number,
    closed: boolean,
  ): Point | null {
    const len = points.length;

    // Search backwards for the nearest on-curve point
    for (let offset = 1; offset < len; offset++) {
      const idx = closed ? (handleIndex - offset + len) % len : handleIndex - offset;
      if (idx < 0) break;

      const pt = points[idx];
      if (pt.pointType === "onCurve") {
        return pt;
      }
    }

    // If no on-curve found backwards, search forwards (shouldn't normally happen)
    for (let offset = 1; offset < len; offset++) {
      const idx = closed ? (handleIndex + offset) % len : handleIndex + offset;
      if (idx >= len) break;

      const pt = points[idx];
      if (pt.pointType === "onCurve") {
        return pt;
      }
    }

    return null;
  }

  /**
   * Scale a handle's distance from its anchor point.
   * Preserves direction, only changes magnitude.
   */
  #scaleHandle(handle: Point, anchor: Point): Point2D | null {
    const anchorPos = { x: anchor.x, y: anchor.y };
    const handlePos = { x: handle.x, y: handle.y };

    // Vector from anchor to handle
    const vec = Vec2.sub(handlePos, anchorPos);
    const currentLen = Vec2.len(vec);

    // If handle is at anchor position, we can't scale (no direction)
    if (currentLen < EPSILON) {
      return null;
    }

    // Calculate new length
    let newLen = currentLen + this.#scaleDelta;

    // Clamp to minimum length to prevent collapse
    if (newLen < MIN_HANDLE_LENGTH) {
      newLen = MIN_HANDLE_LENGTH;
    }

    // Scale the vector to new length
    const normalized = Vec2.normalize(vec);
    const newVec = Vec2.scale(normalized, newLen);

    // New position relative to anchor
    return Vec2.add(anchorPos, newVec);
  }
}
