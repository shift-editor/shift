import { Vec2, type Point2D } from "@shift/geo";
import { Validate } from "@shift/validation";
import type { ContourId, PointId } from "@shift/types";
import type { GlyphLayer, GlyphLayerPositions } from "@/lib/model/Glyph";
import { Point, type Contour, type SegmentId } from "@shift/glyph-state";
import { Anchor, Handles } from "./types";
import type { Pen } from "./Pen";
import { ReverseContourCommand } from "@/lib/commands";
import type { GlyphNode } from "@/types/node";

export class PenStroke {
  #pendingHandles: GlyphLayerPositions | null = null;
  readonly #pen: Pen;
  readonly #node: GlyphNode;
  readonly #layer: GlyphLayer;

  private constructor(pen: Pen, node: GlyphNode, layer: GlyphLayer) {
    this.#pen = pen;
    this.#node = node;
    this.#layer = layer;
  }

  static active(pen: Pen): PenStroke | null {
    const context = pen.context;
    if (!context) return null;

    const sourceId = pen.editor.activeSourceId;
    if (!sourceId) return null;

    const layer = pen.editor.font.layer(context.glyphNode.glyphId, sourceId);
    if (!layer) return null;

    return new PenStroke(pen, context.glyphNode, layer);
  }

  get node(): GlyphNode {
    return this.#node;
  }

  get layer(): GlyphLayer {
    return this.#layer;
  }

  get activeContour(): Contour | null {
    const contourId = this.#pen.context?.activeContourId;
    if (!contourId) return null;

    return this.#layer.contour(contourId);
  }

  startContour(position: Point2D): PointId {
    const contourId = this.#layer.addContour();
    const pointId = this.#layer.addOnCurvePoint(contourId, position);
    this.#pen.setActiveContour(contourId);
    return pointId;
  }

  appendOnCurve(position: Point2D): PointId | null {
    const contour = this.activeContour;
    if (!contour) return null;
    return this.#layer.addOnCurvePoint(contour.id, position);
  }

  closeActiveContour(): boolean {
    const contour = this.activeContour;
    if (!contour) return false;

    this.#layer.closeContour(contour.id);
    this.#pen.clearActiveContour();
    return true;
  }

  canClose(position: Point2D, hitRadius: number): boolean {
    const contour = this.activeContour;
    return contour ? contour.canClose(position, hitRadius) : false;
  }

  continueContour(contourId: ContourId, side: "start" | "end", pointId: PointId): void {
    this.#pen.setActiveContour(contourId);
    if (side === "start") {
      this.#pen.editor.commands.run(new ReverseContourCommand(contourId));
    }
    this.#pen.editor.selection.select([{ kind: "point", pointId }]);
  }

  splitSegment(segmentId: SegmentId, t: number): PointId | null {
    const segment = this.#layer.geometry.segment(segmentId);
    if (!segment) return null;
    return this.#pen.editor.splitSegment(segment, t);
  }

  commitAnchor(anchor: Anchor): PointId | null {
    if (anchor.pointId) return anchor.pointId;

    const pointId = this.appendOnCurve(anchor.position);
    if (pointId) anchor.pointId = pointId;
    return pointId;
  }

  createHandles(anchor: Anchor, handlePos: Point2D): Handles {
    const { position } = anchor;
    const contour = this.activeContour;
    if (!contour) return {};

    const prevPoint = contour.lastPoint;
    const prevOnCurve = contour.lastOnCurvePoint;
    const isFirstPoint = contour.isEmpty;

    const anchorId = this.#layer.addSmoothPoint(contour.id, position);
    anchor.pointId = anchorId;

    if (isFirstPoint) {
      const cpOutId = this.#layer.addOffCurvePoint(contour.id, handlePos);
      return { cpOut: cpOutId };
    }

    const prevIsOffCurve = prevPoint && Validate.isOffCurve(prevPoint);

    if (prevIsOffCurve) {
      const cpInPos = Vec2.mirror(handlePos, position);
      const cpInId = this.#layer.insertPointBefore(anchorId, Point.offCurve(cpInPos));
      const cpOutId = this.#layer.addOffCurvePoint(contour.id, handlePos);

      return { cpIn: cpInId, cpOut: cpOutId };
    }

    if (prevOnCurve) {
      const cp1Pos = Vec2.lerp(prevOnCurve, position, 1 / 3);

      this.#layer.insertPointBefore(anchorId, Point.offCurve(cp1Pos));
    }

    const cpInPos = Vec2.mirror(handlePos, position);
    const cpInId = this.#layer.insertPointBefore(anchorId, Point.offCurve(cpInPos));
    return { cpIn: cpInId };
  }

  moveHandles(anchor: Anchor, handles: Handles, handlePos: Point2D): void {
    const positions: GlyphLayerPositions[number][] = [];

    if (handles.cpOut) {
      positions.push({
        kind: "point",
        id: handles.cpOut,
        x: handlePos.x,
        y: handlePos.y,
      });
    }

    if (handles.cpIn) {
      const mirror = Vec2.mirror(handlePos, anchor.position);
      positions.push({
        kind: "point" as const,
        id: handles.cpIn,
        x: mirror.x,
        y: mirror.y,
      });
    }

    // Live drag: local preview only; durability happens once at gesture end.
    this.#pendingHandles = positions;
    this.#layer.previewPositionPatch(positions);
  }

  /** Commits the last previewed handle positions as one durable move. */
  commitHandles(): void {
    if (!this.#pendingHandles) return;

    this.#layer.commitPositionPatch(this.#pendingHandles);
    this.#pendingHandles = null;
  }
}
