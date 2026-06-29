import type { Canvas } from "@/lib/editor/rendering/Canvas";
import { CanvasItem } from "@/lib/editor/rendering/CanvasItem";
import type { Pen, PenState } from "./Pen";
import { Vec2, type Point2D } from "@shift/geo";
import type { Editor } from "@/lib/editor/Editor";
import type { Coordinates } from "@/types/coordinates";
import { track } from "@/lib/signals";

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

      const { anchor, mousePos } = props.state;
      const anchorPos = Vec2.add(nodePosition, anchor.position);
      const effectivePos = Vec2.add(nodePosition, mousePos);
      const mirrorPos = Vec2.add(nodePosition, Vec2.mirror(mousePos, anchor.position));

      const { stroke, widthPx } = canvas.theme.glyph;
      canvas.line(effectivePos, anchorPos, stroke, widthPx);
      canvas.line(anchorPos, mirrorPos, stroke, widthPx);

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

  #lastOnCurvePoint(): Point2D | null {
    const context = this.#pen.contextCell.value;
    if (!context?.activeContourId) return null;

    const sourceId = this.#editor.activeSourceIdCell.value;
    if (!sourceId) return null;

    const layer = this.#editor.font.layer(context.glyphNode.glyphId, sourceId);
    if (!layer) return null;

    track(layer.structureCell);
    track(layer.coordinateBuffersChangedCell);

    const contour = layer.contour(context.activeContourId);
    if (!contour || contour.isEmpty || contour.closed) return null;

    const lastOnCurve = contour.lastOnCurvePoint;
    if (!lastOnCurve) return null;

    return { x: lastOnCurve.x, y: lastOnCurve.y };
  }
}
