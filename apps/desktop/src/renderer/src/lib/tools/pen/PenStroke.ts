import { Vec2, type Point2D } from "@shift/geo";
import type { ContourId, PointId } from "@shift/types";
import { Point, type Contour, type SegmentId } from "@shift/glyph-state";
import type { GlyphLayer } from "@/lib/model/Glyph";
import type { GlyphLayerEdit } from "@/lib/model/GlyphLayerEdit";
import type { GlyphNode } from "@/types/node";
import type { Pen } from "./Pen";
import type { PenCurve, PenEndpoint } from "./types";

export class PenStroke {
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

    const layer = pen.editor
      .glyphForId(context.glyphNode.glyphId)
      ?.layerForSource(context.glyphNode.sourceId);
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

  get activeEndpoint(): PenEndpoint | null {
    return this.#pen.context?.activeEndpoint ?? null;
  }

  startContour(position: Point2D): PointId {
    const [contourId, pointId] = this.#pen.editor.transaction("Start contour", () => {
      const contourId = this.#layer.addContour();
      const pointId = this.#layer.addOnCurvePoint(contourId, position);
      return [contourId, pointId] as const;
    });

    this.#pen.setActiveContour(contourId, {
      kind: "corner",
      pointId,
      position,
    });
    return pointId;
  }

  appendOnCurve(position: Point2D): PointId | null {
    const contourId = this.#pen.context?.activeContourId;
    if (!contourId) return null;

    const pointId = this.#layer.addOnCurvePoint(contourId, position);
    this.#pen.setActiveEndpoint({ kind: "corner", pointId, position });
    return pointId;
  }

  beginCurve(curve: PenCurve): readonly [GlyphLayerEdit, PointId, PointId, PointId] {
    const context = this.#pen.context;
    if (!context?.activeContourId) {
      throw new Error("cannot begin curve without an active Pen contour");
    }

    if (context.activeEndpoint.pointId !== curve.start.pointId) {
      throw new Error("cannot begin curve from a stale Pen endpoint");
    }

    const edit = this.#layer.beginEdit();

    try {
      if (curve.start.kind === "smooth") {
        edit.setPointSmooth(curve.start.pointId, true);
      }

      const geometry = this.#pen.resolveCurve(curve);
      const [controlStartId, controlEndId, endpointId] = edit.addPoints(context.activeContourId, [
        Point.offCurve(geometry.c0),
        Point.offCurve(geometry.c1),
        Point.onCurve(geometry.p1),
      ]);
      if (!controlStartId || !controlEndId || !endpointId) {
        throw new Error("cannot begin Pen curve without a complete cubic point sequence");
      }

      return [edit, controlStartId, controlEndId, endpointId];
    } catch (error) {
      edit.cancel();
      throw error;
    }
  }

  finishCurve(curve: PenCurve, edit: GlyphLayerEdit, endpointId: PointId): void {
    edit.finish("Add cubic");
    this.#pen.setActiveEndpoint({
      kind: "smooth",
      pointId: endpointId,
      position: curve.anchorPosition,
      outgoingHandlePosition: curve.handlePosition,
    });
  }

  closeActiveContour(): boolean {
    const contourId = this.#pen.context?.activeContourId;
    if (!contourId) return false;

    this.#layer.closeContour(contourId);
    this.#pen.clearActiveContour();
    return true;
  }

  canClose(position: Point2D, hitRadius: number): boolean {
    const contour = this.activeContour;
    return contour ? contour.canClose(position, hitRadius) : false;
  }

  continueContour(contourId: ContourId, side: "start" | "end", pointId: PointId): void {
    const contour = this.#layer.contour(contourId);
    const endpoint = contour ? this.#endpointFor(contour, side, pointId) : null;
    if (!endpoint) return;

    if (side === "start") {
      this.#layer.reverseContour(contourId);
    }

    this.#pen.setActiveContour(contourId, endpoint);
    this.#pen.editor.selection.select([pointId]);
  }

  splitSegment(segmentId: SegmentId, t: number): PointId | null {
    return this.#layer.splitSegment(segmentId, t);
  }

  commitAnchor(position: Point2D): PointId | null {
    return this.appendOnCurve(position);
  }

  #endpointFor(contour: Contour, side: "start" | "end", pointId: PointId): PenEndpoint | null {
    const anchor = side === "start" ? contour.firstPoint : contour.lastPoint;
    if (!anchor || anchor.id !== pointId || !anchor.isOnCurve) return null;

    const adjacent =
      side === "start" ? contour.points[1] : contour.points[contour.points.length - 2];
    if (anchor.smooth && adjacent?.isOffCurve) {
      return {
        kind: "smooth",
        pointId,
        position: anchor.position,
        outgoingHandlePosition: Vec2.mirror(adjacent, anchor),
      };
    }

    return { kind: "corner", pointId, position: anchor.position };
  }
}
