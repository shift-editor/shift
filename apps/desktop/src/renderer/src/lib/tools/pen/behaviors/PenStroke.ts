import { Vec2, type Point2D } from "@shift/geo";
import { Validate } from "@shift/validation";
import type { ContourId, PointId } from "@shift/types";
import type { Editor } from "@/lib/editor/Editor";
import type { GlyphSource, SourcePositions } from "@/lib/model/Glyph";
import type { Contour } from "@shift/glyph-state";
import type { Anchor, Handles } from "../types";

type PointKind = "onCurve" | "offCurve";

export class PenStroke {
  readonly #editor: Editor;
  readonly #source: GlyphSource;

  private constructor(editor: Editor, source: GlyphSource) {
    this.#editor = editor;
    this.#source = source;
  }

  static active(editor: Editor): PenStroke | null {
    const source = editor.activeGlyphSource;
    return source ? new PenStroke(editor, source) : null;
  }

  get activeContour(): Contour | null {
    const contourId = this.#editor.getActiveContourId();
    return contourId ? this.#source.contour(contourId) : null;
  }

  startContour(position: Point2D): PointId {
    const contourId = this.#source.addContour();
    this.#editor.setActiveContour(contourId);
    return this.#addPoint(contourId, position, "onCurve", false);
  }

  appendOnCurve(position: Point2D): PointId | null {
    const contour = this.activeContour;
    if (!contour) return null;
    return this.#addPoint(contour.id, position, "onCurve", false);
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

    const anchorId = this.#addPoint(contour.id, position, "onCurve", true);
    anchor.pointId = anchorId;

    if (isFirstPoint) {
      const cpOutId = this.#addPoint(contour.id, handlePos, "offCurve", false);
      return { cpOut: cpOutId };
    }

    const prevIsOffCurve = prevPoint && Validate.isOffCurve(prevPoint);

    if (prevIsOffCurve) {
      const cpInPos = Vec2.mirror(handlePos, position);
      const cpInId = this.#source.insertPointBefore(
        anchorId,
        pointEdit(cpInPos, "offCurve", false),
      );
      const cpOutId = this.#addPoint(contour.id, handlePos, "offCurve", false);
      return { cpIn: cpInId, cpOut: cpOutId };
    }

    if (prevOnCurve) {
      const cp1Pos = Vec2.lerp(prevOnCurve, position, 1 / 3);
      this.#source.insertPointBefore(anchorId, pointEdit(cp1Pos, "offCurve", false));
    }

    const cpInPos = Vec2.mirror(handlePos, position);
    const cpInId = this.#source.insertPointBefore(anchorId, pointEdit(cpInPos, "offCurve", false));
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
      positions.push({ kind: "point" as const, id: handles.cpIn, x: mirror.x, y: mirror.y });
    }

    this.#source.setPositions(positions);
  }

  #addPoint(
    contourId: ContourId,
    position: Point2D,
    pointType: PointKind,
    smooth: boolean,
  ): PointId {
    return this.#source.addPoint(contourId, pointEdit(position, pointType, smooth));
  }
}

function pointEdit(position: Point2D, pointType: PointKind, smooth: boolean) {
  return { x: position.x, y: position.y, pointType, smooth };
}
