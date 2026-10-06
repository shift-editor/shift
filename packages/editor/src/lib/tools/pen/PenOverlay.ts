import type { Point2D } from "@shift/geo";
import type { Canvas } from "../../editor/rendering/Canvas";
import { CanvasItem } from "../../editor/rendering/CanvasItem";
import { SnapLines } from "../../editor/rendering/overlays/SnapLines";
import type { Editor } from "../../editor/Editor";
import type { Pen } from "./Pen";
import { PenStroke } from "./PenStroke";
import { PenTargets } from "./PenTargets";
import { normalizeModifiers } from "../core/GestureDetector";
import type { PenOverlayProps } from "./types";
import type { GlyphNode } from "../../../types/node";
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
      node: context?.glyphNode ?? null,
      lastOnCurvePoint: activeEndpoint?.position ?? null,
      pendingHandle,
    };
  }

  draw(canvas: Canvas): void {
    const props = this.propsCell.value;
    if (!props) return;

    const node = props.node;
    if (!node) {
      if (props.state.type === "ready" && props.pointer) {
        this.#drawPointer(canvas, props.pointer.scene);
      }
      return;
    }

    canvas.withTransform(this.#editor.sceneTransform(node), () => {
      this.#drawInNode(canvas, props, node);
    });
  }

  #drawInNode(canvas: Canvas, props: PenOverlayProps, node: GlyphNode): void {
    switch (props.state.type) {
      case "ready":
        this.#drawReady(canvas, props, node);
        return;
      case "dragging": {
        const { start } = props.state.curve;
        if (start.kind !== "corner") {
          this.#drawHandle(canvas, start.position, start.outgoingHandlePosition);
        }
        this.#drawHandle(
          canvas,
          props.state.curve.anchorPosition,
          props.state.curve.handlePosition,
        );
        this.#snapLines.draw(canvas, props.state.guides);
        return;
      }
      case "pulling": {
        const { pull } = props.state;
        if (!pull.handlePosition) return;

        this.#drawHandle(canvas, pull.position, pull.handlePosition);
        this.#snapLines.draw(canvas, props.state.guides);
        return;
      }
      case "closing":
        this.#snapLines.draw(canvas, props.state.guides);
        return;
      case "idle":
      case "anchored":
        return;
    }
  }

  #drawReady(canvas: Canvas, props: PenOverlayProps, node: GlyphNode): void {
    if (props.lastOnCurvePoint && props.pendingHandle) {
      this.#drawHandle(canvas, props.lastOnCurvePoint, props.pendingHandle);
    }

    const pointer = props.pointer;
    if (!pointer) return;

    const nodePoint = this.#editor.toLocal(node, pointer.scene);
    const stroke = PenStroke.active(this.#pen);
    const target = stroke
      ? PenTargets.forGeometry(stroke.layer.geometry).at(nodePoint, this.#editor.hitRadius)
      : null;
    const modifiers = normalizeModifiers(this.#editor.input.modifiersCell.peek());
    const anchor =
      target?.type === "empty" || target?.type === "point"
        ? this.#pen.anchorFor(target, nodePoint, modifiers)
        : { position: nodePoint, guides: [] };

    if (props.lastOnCurvePoint) {
      canvas.line(
        props.lastOnCurvePoint,
        anchor.position,
        canvas.theme.preview.color,
        canvas.theme.preview.widthPx,
      );
    }

    const crossings = stroke ? this.#editor.snapping.crossings(stroke.layer) : [];
    this.#snapLines.draw(canvas, anchor.guides, crossings);
    this.#drawPointer(canvas, anchor.position);
  }

  #drawPointer(canvas: Canvas, position: Point2D): void {
    const { fill, stroke, size, widthPx } = canvas.theme.penReady;
    canvas.filledStrokeCircle(position, size, fill, stroke, widthPx);
  }

  #drawHandle(canvas: Canvas, anchor: Point2D, handle: Point2D): void {
    const { stroke, widthPx } = canvas.theme.glyph;
    canvas.line(anchor, handle, stroke, widthPx);

    const controlStyle = canvas.theme.handle.control.idle;
    canvas.filledStrokeCircle(
      handle,
      controlStyle.size,
      controlStyle.fill,
      controlStyle.stroke,
      controlStyle.lineWidth,
    );
  }
}
