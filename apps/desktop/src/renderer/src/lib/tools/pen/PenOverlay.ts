import { Vec2, type Point2D } from "@shift/geo";
import type { Canvas } from "@/lib/editor/rendering/Canvas";
import { CanvasItem } from "@/lib/editor/rendering/CanvasItem";
import type { Editor } from "@/lib/editor/Editor";
import type { Pen, PenState } from "./Pen";
import type { PenOverlayProps } from "./types";

/** Draws Pen interaction chrome that is not part of glyph topology. */
export class PenOverlay extends CanvasItem<PenOverlayProps> {
  readonly #pen: Pen;
  readonly #editor: Editor;

  constructor(pen: Pen) {
    super();

    this.#editor = pen.editor;
    this.#pen = pen;
  }

  protected props(): PenOverlayProps {
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

    switch (props.state.type) {
      case "ready":
        this.#drawReady(canvas, props);
        return;
      case "dragging":
        this.#drawOutgoingHandle(canvas, props.state, props.nodePosition);
        return;
      case "idle":
      case "anchored":
        return;
    }
  }

  #drawReady(canvas: Canvas, props: PenOverlayProps): void {
    const pos = props.pointer;
    if (!pos) return;

    if (props.lastOnCurvePoint && props.nodePosition) {
      canvas.line(
        Vec2.add(props.nodePosition, props.lastOnCurvePoint),
        pos.scene,
        canvas.theme.preview.color,
        canvas.theme.preview.widthPx,
      );
    }

    const { fill, stroke, size, widthPx } = canvas.theme.penReady;
    canvas.filledStrokeCircle(pos.scene, size, fill, stroke, widthPx);
  }

  #drawOutgoingHandle(
    canvas: Canvas,
    state: PenState & { type: "dragging" },
    nodePosition: Point2D | null,
  ): void {
    if (!nodePosition) return;

    const anchorPos = Vec2.add(nodePosition, state.curve.anchorPosition);
    const handlePos = Vec2.add(nodePosition, state.curve.handlePosition);
    const { stroke, widthPx } = canvas.theme.glyph;
    canvas.line(anchorPos, handlePos, stroke, widthPx);

    const controlStyle = canvas.theme.handle.control.idle;
    canvas.filledStrokeCircle(
      handlePos,
      controlStyle.size,
      controlStyle.fill,
      controlStyle.stroke,
      controlStyle.lineWidth,
    );
  }

  #lastOnCurvePoint(): Point2D | null {
    return this.#pen.contextCell.peek()?.activeEndpoint?.position ?? null;
  }
}
