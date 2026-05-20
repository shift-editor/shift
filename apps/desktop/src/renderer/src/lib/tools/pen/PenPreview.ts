import { Canvas } from "@/lib/editor/rendering/Canvas";
import { CanvasItem } from "@/lib/editor/rendering/CanvasItem";
import { Pen, PenState } from "./Pen";
import { Point2D, Vec2 } from "@shift/geo";
import { Editor } from "@/lib/editor/Editor";
import { Coordinates } from "@/types/coordinates";
import { ContourId } from "@shift/types";

export interface PenPreviewProps {
  state: PenState;
  pointer: Coordinates | null;
  activeContourId: ContourId | null;
}
export class PenPreview extends CanvasItem<PenPreviewProps> {
  readonly #pen: Pen;
  readonly #editor: Editor;

  constructor(pen: Pen) {
    super();

    this.#editor = pen.editor;
    this.#pen = pen;
  }

  protected props(): PenPreviewProps {
    this.#pen.stateCell.value;

    return {
      state: this.#pen.stateCell.value,
      pointer: this.#editor.input.pointerCell.value,
      activeContourId: this.#editor.activeContourIdCell.value,
    };
  }

  draw(canvas: Canvas): void {
    const props = this.props();
    const pos = props.pointer;
    if (!pos) return;

    if (props.state.type === "ready") {
      const lastPoint = this.#getLastOnCurvePoint();
      if (lastPoint) {
        canvas.line(
          lastPoint,
          pos.glyphLocal,
          canvas.theme.preview.color,
          canvas.theme.preview.widthPx,
        );
      }

      const { fill, stroke, size, widthPx } = canvas.theme.penReady;
      canvas.filledStrokeCircle(pos.glyphLocal, size, fill, stroke, widthPx);
    }

    if (props.state.type === "dragging") {
      const { anchor, mousePos } = props.state;
      const effectivePos = mousePos;
      const mirrorPos = Vec2.mirror(effectivePos, anchor.position);

      const { stroke, widthPx } = canvas.theme.glyph;
      canvas.line(effectivePos, anchor.position, stroke, widthPx);
      canvas.line(anchor.position, mirrorPos, stroke, widthPx);

      // Draw control handle previews
      const controlStyle = canvas.theme.handle.control.idle;
      canvas.filledStrokeCircle(
        effectivePos,
        controlStyle.size,
        controlStyle.fill,
        controlStyle.stroke,
        controlStyle.lineWidth,
      );
      canvas.filledStrokeCircle(
        mirrorPos,
        controlStyle.size,
        controlStyle.fill,
        controlStyle.stroke,
        controlStyle.lineWidth,
      );
    }
  }

  #getLastOnCurvePoint(): Point2D | null {
    const contour = this.#editor.getActiveContour();
    if (!contour || contour.isEmpty || contour.closed) {
      return null;
    }

    const lastOnCurve = contour.lastOnCurvePoint;
    if (!lastOnCurve) return null;

    return { x: lastOnCurve.x, y: lastOnCurve.y };
  }
}
