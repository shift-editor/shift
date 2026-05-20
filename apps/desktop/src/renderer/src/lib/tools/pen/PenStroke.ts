import { Vec2, type Point2D } from "@shift/geo";
import { Validate } from "@shift/validation";
import type { ContourId, PointId } from "@shift/types";
import type { Editor } from "@/lib/editor/Editor";
import type {
  GlyphInstanceGeometry,
  GlyphSource,
  SourcePositions,
} from "@/lib/model/Glyph";
import { Point, type Contour, type SegmentId } from "@shift/glyph-state";
import { Anchor, Handles } from "./types";

export class PenStroke {
  readonly #editor: Editor;
  readonly #source: GlyphSource;

  private constructor(editor: Editor, source: GlyphSource) {
    this.#editor = editor;
    this.#source = source;
  }

  static active(editor: Editor): PenStroke | null {
    const source = editor.editGlyphSource;
    if (!source) return null;

    return new PenStroke(editor, source);
  }

  get activeContour(): Contour | null {
    const contourId = this.#editor.getActiveContourId();
    if (!contourId) return null;

    return this.#source.contour(contourId);
  }

  get geometry(): GlyphInstanceGeometry {
    return this.#source.geometry;
  }

  startContour(position: Point2D): PointId {
    const contourId = this.#source.addContour();
    const pointId = this.#source.addOnCurvePoint(contourId, position);
    this.#editor.setActiveContour(contourId);
    return pointId;
  }

  appendOnCurve(position: Point2D): PointId | null {
    const contour = this.activeContour;
    if (!contour) return null;
    return this.#source.addOnCurvePoint(contour.id, position);
  }

  closeActiveContour(): boolean {
    const contour = this.activeContour;
    if (!contour) return false;

    this.#source.closeContour(contour.id);
    this.#editor.clearActiveContour();
    return true;
  }

  canClose(position: Point2D, hitRadius: number): boolean {
    const contour = this.activeContour;
    return contour ? contour.canClose(position, hitRadius) : false;
  }

  continueContour(
    contourId: ContourId,
    side: "start" | "end",
    pointId: PointId,
  ): void {
    this.#editor.continueContour(contourId, side === "start", pointId);
  }

  splitSegment(segmentId: SegmentId, t: number): PointId | null {
    const segment = this.#source.geometry.segment(segmentId);
    if (!segment) return null;
    return this.#editor.splitSegment(segment, t);
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

    const anchorId = this.#source.addSmoothPoint(contour.id, position);
    anchor.pointId = anchorId;

    if (isFirstPoint) {
      const cpOutId = this.#source.addOffCurvePoint(contour.id, handlePos);
      return { cpOut: cpOutId };
    }

    const prevIsOffCurve = prevPoint && Validate.isOffCurve(prevPoint);

    if (prevIsOffCurve) {
      const cpInPos = Vec2.mirror(handlePos, position);
      const cpInId = this.#source.insertPointBefore(
        anchorId,
        Point.offCurve(cpInPos),
      );
      const cpOutId = this.#source.addOffCurvePoint(contour.id, handlePos);

      return { cpIn: cpInId, cpOut: cpOutId };
    }

    if (prevOnCurve) {
      const cp1Pos = Vec2.lerp(prevOnCurve, position, 1 / 3);

      this.#source.insertPointBefore(anchorId, Point.offCurve(cp1Pos));
    }

    const cpInPos = Vec2.mirror(handlePos, position);
    const cpInId = this.#source.insertPointBefore(
      anchorId,
      Point.offCurve(cpInPos),
    );
    return { cpIn: cpInId };
  }

  moveHandles(anchor: Anchor, handles: Handles, handlePos: Point2D): void {
    const positions: SourcePositions[number][] = [];

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

    this.#source.applyPositionPatch(positions);
  }
}
