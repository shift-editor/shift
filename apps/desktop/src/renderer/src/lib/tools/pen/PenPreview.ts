import type { Canvas } from "@/lib/editor/rendering/Canvas";
import { CanvasItem } from "@/lib/editor/rendering/CanvasItem";
import type { Pen, PenState } from "./Pen";
import { Vec2, type CubicCurve, type Point2D } from "@shift/geo";
import { penCurveGeometry } from "./PenCurve";
import type { Editor } from "@/lib/editor/Editor";
import type { Coordinates } from "@/types/coordinates";
import { drawHandleLast } from "@/lib/editor/rendering/overlays";

export interface PenPreviewProps {
  state: PenState;
  pointer: Coordinates | null;
  nodePosition: Point2D | null;
  lastOnCurvePoint: Point2D | null;
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
    return {
      state: this.#pen.stateCell.value,
      pointer: this.#editor.input.pointerCell.value,
      nodePosition: this.#pen.contextCell.value?.glyphNode.position ?? null,
      lastOnCurvePoint: this.#lastOnCurvePoint(),
    };
  }

  draw(canvas: Canvas): void {
    const props = this.propsCell.value;
    if (!props) return;

    const pos = props.pointer;
    if (!pos) return;

    if (props.state.type === "ready") {
      const lastPoint = props.lastOnCurvePoint;
      const nodePosition = props.nodePosition;
      if (lastPoint && nodePosition) {
        canvas.line(
          Vec2.add(nodePosition, lastPoint),
          pos.scene,
          canvas.theme.preview.color,
          canvas.theme.preview.widthPx,
        );
      }

      const { fill, stroke, size, widthPx } = canvas.theme.penReady;
      canvas.filledStrokeCircle(pos.scene, size, fill, stroke, widthPx);
    }

    if (props.state.type === "dragging") {
      const nodePosition = props.nodePosition;
      if (!nodePosition) return;

      const geometry = penCurveGeometry(props.state.curve);
      this.#drawCurvePreview(canvas, geometry, nodePosition);

      const startPos = Vec2.add(nodePosition, geometry.p0);
      const controlStartPos = Vec2.add(nodePosition, geometry.c0);
      const anchorPos = Vec2.add(nodePosition, geometry.p1);
      const effectivePos = Vec2.add(nodePosition, props.state.curve.handlePosition);
      const mirrorPos = Vec2.add(nodePosition, geometry.c1);

      const { stroke, widthPx } = canvas.theme.glyph;
      canvas.line(startPos, controlStartPos, stroke, widthPx);
      canvas.line(effectivePos, anchorPos, stroke, widthPx);
      canvas.line(anchorPos, mirrorPos, stroke, widthPx);

      const controlStyle = canvas.theme.handle.control.idle;
      for (const position of [controlStartPos, effectivePos, mirrorPos]) {
        canvas.filledStrokeCircle(
          position,
          controlStyle.size,
          controlStyle.fill,
          controlStyle.stroke,
          controlStyle.lineWidth,
        );
      }

      drawHandleLast(canvas, anchorPos, mirrorPos, "selected");
    }
  }

  #drawCurvePreview(canvas: Canvas, geometry: CubicCurve, nodePosition: Point2D): void {
    const path = new Path2D();
    path.moveTo(geometry.p0.x, geometry.p0.y);
    path.bezierCurveTo(
      geometry.c0.x,
      geometry.c0.y,
      geometry.c1.x,
      geometry.c1.y,
      geometry.p1.x,
      geometry.p1.y,
    );

    canvas.withTranslation(nodePosition, (translatedCanvas) => {
      const { stroke, widthPx } = translatedCanvas.theme.glyph;
      translatedCanvas.strokePath(path, stroke, widthPx);
    });
  }

  #lastOnCurvePoint(): Point2D | null {
    return this.#pen.contextCell.peek()?.activeEndpoint?.position ?? null;
  }
}
