import { Vec2, type Point2D } from "@shift/geo";
import type { Canvas } from "../../editor/rendering/Canvas";
import { CanvasItem } from "../../editor/rendering/CanvasItem";
import { SnapLines } from "../../editor/rendering/overlays/SnapLines";
import type { Editor } from "../../editor/Editor";
import type { Pen, PenState } from "./Pen";
import { PenStroke } from "./PenStroke";
import { PenTargets } from "./PenTargets";
import type { PenOverlayProps } from "./types";
import { track } from "@shift/editor/lib/signals/index";

/** Draws Pen interaction chrome that is not part of glyph topology. */
export class PenOverlay extends CanvasItem<PenOverlayProps> {
  readonly #pen: Pen;
  readonly #editor: Editor;
  readonly #snapLines = new SnapLines();

  constructor(pen: Pen) {
    super();

    this.#editor = pen.editor;
    this.#pen = pen;
  }

  protected props(): PenOverlayProps {
    const context = this.#pen.contextCell.value;
    track(this.#editor.input.modifiersCell);
    const state = this.#pen.stateCell.value;
    const activeEndpoint = state.type === "ready" ? this.#pen.activeEndpointCell.value : null;

    return {
      state,
      pointer: this.#editor.input.pointerCell.value,
      nodePosition: context?.glyphNode.position ?? null,
      lastOnCurvePoint: activeEndpoint?.position ?? null,
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
        if (!props.nodePosition) return;

        this.#snapLines.draw(canvas, props.state.guides, props.nodePosition);
        return;
      case "idle":
      case "anchored":
        return;
    }
  }

  #drawReady(canvas: Canvas, props: PenOverlayProps): void {
    const pointer = props.pointer;
    if (!pointer) return;

    let pointerPosition = pointer.scene;
    if (props.lastOnCurvePoint && props.nodePosition) {
      const stroke = PenStroke.active(this.#pen);
      const nodePoint = this.#editor.getPointInNodeSpace(pointer.scene, props.nodePosition);
      const target = stroke
        ? PenTargets.forGeometry(stroke.layer.geometry).at(nodePoint, this.#editor.hitRadius)
        : null;
      const anchorPosition =
        target?.type === "empty"
          ? this.#pen.resolveAnchorPosition(
              nodePoint,
              this.#editor.input.modifiersCell.peek().shiftKey,
            )
          : nodePoint;
      pointerPosition = Vec2.add(props.nodePosition, anchorPosition);

      canvas.line(
        Vec2.add(props.nodePosition, props.lastOnCurvePoint),
        pointerPosition,
        canvas.theme.preview.color,
        canvas.theme.preview.widthPx,
      );

      if (target?.type === "empty" && this.#editor.input.modifiersCell.peek().shiftKey) {
        this.#snapLines.draw(
          canvas,
          [{ kind: "direction", from: props.lastOnCurvePoint, to: anchorPosition }],
          props.nodePosition,
        );
      }
    }

    const { fill, stroke, size, widthPx } = canvas.theme.penReady;
    canvas.filledStrokeCircle(pointerPosition, size, fill, stroke, widthPx);
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
}
