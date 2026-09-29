import { Vec2, type Point2D } from "@shift/geo";
import type { Canvas } from "../../editor/rendering/Canvas";
import { CanvasItem } from "../../editor/rendering/CanvasItem";
import { SnapLines } from "../../editor/rendering/overlays/SnapLines";
import type { Editor } from "../../editor/Editor";
import type { Pen } from "./Pen";
import { PenStroke } from "./PenStroke";
import { PenTargets } from "./PenTargets";
import type { PenOverlayProps } from "./types";
import { track } from "../../signals/index";

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
    const pendingHandle =
      activeEndpoint && activeEndpoint.kind !== "corner"
        ? activeEndpoint.outgoingHandlePosition
        : null;

    return {
      state,
      pointer: this.#editor.input.pointerCell.value,
      nodePosition: context?.glyphNode.position ?? null,
      lastOnCurvePoint: activeEndpoint?.position ?? null,
      pendingHandle,
    };
  }

  draw(canvas: Canvas): void {
    const props = this.propsCell.value;
    if (!props) return;

    switch (props.state.type) {
      case "ready":
        this.#drawReady(canvas, props);
        return;
      case "dragging": {
        const { start } = props.state.curve;
        if (start.kind !== "corner") {
          this.#drawHandle(
            canvas,
            start.position,
            start.outgoingHandlePosition,
            props.nodePosition,
          );
        }
        this.#drawHandle(
          canvas,
          props.state.curve.anchorPosition,
          props.state.curve.handlePosition,
          props.nodePosition,
        );
        if (!props.nodePosition) return;

        this.#snapLines.draw(canvas, props.state.guides, props.nodePosition);
        return;
      }
      case "pulling": {
        const { pull } = props.state;
        if (!pull.handlePosition || !props.nodePosition) return;

        this.#drawHandle(canvas, pull.position, pull.handlePosition, props.nodePosition);
        this.#snapLines.draw(canvas, props.state.guides, props.nodePosition);
        return;
      }
      case "closing":
        if (!props.nodePosition) return;

        this.#snapLines.draw(canvas, props.state.guides, props.nodePosition);
        return;
      case "idle":
      case "anchored":
        return;
    }
  }

  #drawReady(canvas: Canvas, props: PenOverlayProps): void {
    if (props.lastOnCurvePoint && props.pendingHandle) {
      this.#drawHandle(canvas, props.lastOnCurvePoint, props.pendingHandle, props.nodePosition);
    }

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

  #drawHandle(
    canvas: Canvas,
    anchor: Point2D,
    handle: Point2D,
    nodePosition: Point2D | null,
  ): void {
    if (!nodePosition) return;

    const anchorPos = Vec2.add(nodePosition, anchor);
    const handlePos = Vec2.add(nodePosition, handle);
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
