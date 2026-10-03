import { Bounds, Mat, Vec2, type Point2D, type Rect2D } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { DragEvent, DragStartEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { Select } from "../Select";
import type { BoundingRectEdge as NullableBoundingRectEdge } from "../cursor";
import { PositionEdits, PositionList, type ScaleEdit } from "../../../model/positions";
import type { ComponentTransformEdit } from "../../../model/ComponentTransformEdit";
import type { Editor } from "../../../editor/Editor";
import { localBounds, scenePoint } from "../../../editor/spaces";
import type { LocalBounds } from "../../../../types/coordinates";
import type { ShiftNode } from "../../../../types/node";

type BoundingRectEdge = Exclude<NullableBoundingRectEdge, null>;

export class Resize implements SelectBehavior {
  #editor: Editor | null = null;
  #node: ShiftNode | null = null;
  #edit: ScaleEdit | null = null;
  #componentEdit: ComponentTransformEdit | null = null;
  #done: (() => void) | null = null;

  onDragStart(
    _state: SelectState,
    ctx: ToolContext<SelectState, Select>,
    event: DragStartEvent,
  ): boolean {
    if (!ctx.editor.selection.hasSelection()) return false;

    const hit = ctx.tool.boundingBox.hit(event.origin);
    if (hit?.type !== "resize") return false;

    const componentSelection = ctx.editor.componentTransformSelection(ctx.editor.selection.ids);
    const positionSelection = ctx.editor.positionSelection(ctx.editor.selection.ids);
    if (!componentSelection && !positionSelection) return false;

    const node = ctx.editor.selectionNode();
    if (!node) return false;

    let targetBounds: LocalBounds;
    if (componentSelection) {
      targetBounds = localBoundsOfRect(componentSelection.bounds);
    } else if (positionSelection) {
      const positions = PositionList.fromTargetGroups(
        positionSelection.layer,
        positionSelection.targets,
      ).positions;
      const bounds = Bounds.fromPoints(positions);
      if (!bounds) return false;

      targetBounds = localBounds(bounds);
    } else {
      return false;
    }

    this.#editor = ctx.editor;
    this.#node = node;

    const edge = hit.edge;
    const startPos = event.origin.scene;

    const anchorPoint = this.getAnchorPointForEdge(edge, hit.rect, event.altKey);
    const localAnchorPoint = this.#localAnchor(edge, targetBounds, event.altKey);

    if (componentSelection) {
      this.#componentEdit =
        componentSelection.layer.beginComponentTransformEdit(componentSelection);
    } else if (positionSelection) {
      this.#edit = PositionEdits.fromSelection(positionSelection).scale(
        positionSelection.targets,
        localAnchorPoint,
      );
    }
    const edit = this.#edit;
    const componentEdit = this.#componentEdit;
    this.#done = ctx.onCancel(() => {
      edit?.discard();
      componentEdit?.discard();
    });

    ctx.setState({
      type: "resizing",
      resize: {
        edge,
        startPos,
        lastPos: startPos,
        initialBounds: hit.rect,
        localBounds: targetBounds,
        anchorPoint,
        uniformScale: false,
        flipX: false,
        flipY: false,
      },
    });

    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState, Select>, event: DragEvent): boolean {
    if (state.type !== "resizing") return false;
    if (!this.#edit && !this.#componentEdit) return false;

    const next = this.nextResizingState(state, event);
    ctx.setState(next);
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "resizing") return false;

    this.#edit?.commit();
    this.#componentEdit?.commit("Scale components");
    if (this.#done) this.#done();
    this.#cleanup();

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "resizing") return false;

    this.#cleanup();

    ctx.setState({ type: "ready" });
    return true;
  }

  onStateEnter(prev: SelectState, next: SelectState, ctx: ToolContext<SelectState, Select>): void {
    const editor = ctx.editor;
    if (prev.type !== "resizing" && next.type === "resizing") {
      editor.hover.clear();
    }
  }

  /**
   * Returns the pivot for `edge` in the node's units.
   *
   * @remarks
   * Edges are named as the user sees them on screen. The node's units may be
   * flipped relative to the scene, so the anchor is chosen on the bounds in
   * scene space and converted back, rather than read from the local corners.
   */
  #localAnchor(edge: BoundingRectEdge, bounds: LocalBounds, useCentre: boolean): Point2D {
    const editor = this.#editor;
    const node = this.#node;
    if (!editor || !node) return Bounds.center(bounds);

    const sceneRect = Bounds.toRect(editor.toSceneBounds(node, bounds));
    const anchor = this.getAnchorPointForEdge(edge, sceneRect, useCentre);
    return editor.toLocal(node, scenePoint(anchor.x, anchor.y));
  }

  #cleanup(): void {
    this.#editor = null;
    this.#node = null;
    this.#edit = null;
    this.#componentEdit = null;
    this.#done = null;
  }

  private nextResizingState(state: SelectState, event: DragEvent): SelectState {
    if (state.type !== "resizing") return state;
    if (!this.#edit && !this.#componentEdit) return state;

    const uniformScale = event.shiftKey;
    const currentPos = event.coords.scene;
    const anchorPoint = this.getAnchorPointForEdge(
      state.resize.edge,
      state.resize.initialBounds,
      event.altKey,
    );
    const localAnchorPoint = this.#localAnchor(
      state.resize.edge,
      state.resize.localBounds,
      event.altKey,
    );

    const { sx, sy } = this.calculateScaleFactors(
      state.resize.edge,
      currentPos,
      anchorPoint,
      state.resize.initialBounds,
      uniformScale,
    );

    if (this.#componentEdit) {
      this.#componentEdit.preview((layer) => {
        const origin = this.#localAnchor(
          state.resize.edge,
          localBoundsOfRect(layer.bounds),
          event.altKey,
        );
        const scale = Mat.Scale(sx, sy);
        const fromOrigin = Mat.Translate(-origin.x, -origin.y);
        const toOrigin = Mat.Translate(origin.x, origin.y);
        return Mat.Compose(toOrigin, Mat.Compose(scale, fromOrigin));
      });
    } else {
      this.#edit?.preview({ x: sx, y: sy }, localAnchorPoint);
    }

    return {
      type: "resizing",
      resize: {
        ...state.resize,
        lastPos: currentPos,
        anchorPoint,
        uniformScale,
        flipX: sx < 0,
        flipY: sy < 0,
      },
    };
  }

  private getAnchorPointForEdge(edge: BoundingRectEdge, rect: Rect2D, useCentre: boolean): Point2D {
    const center = Vec2.midpoint({ x: rect.left, y: rect.top }, { x: rect.right, y: rect.bottom });
    if (useCentre) return center;

    switch (edge) {
      case "top-left":
        return { x: rect.right, y: rect.bottom };
      case "top-right":
        return { x: rect.left, y: rect.bottom };
      case "bottom-left":
        return { x: rect.right, y: rect.top };
      case "bottom-right":
        return { x: rect.left, y: rect.top };
      case "left":
        return { x: rect.right, y: center.y };
      case "right":
        return { x: rect.left, y: center.y };
      case "top":
        return { x: center.x, y: rect.bottom };
      case "bottom":
        return { x: center.x, y: rect.top };
    }
  }

  private calculateScaleFactors(
    edge: BoundingRectEdge,
    currentPos: Point2D,
    anchorPoint: Point2D,
    initialBounds: Rect2D,
    uniform: boolean,
  ): { sx: number; sy: number } {
    if (initialBounds.width === 0 || initialBounds.height === 0) {
      return { sx: 1, sy: 1 };
    }

    const newWidth = Math.abs(currentPos.x - anchorPoint.x);
    const newHeight = Math.abs(currentPos.y - anchorPoint.y);

    let sx = 1;
    let sy = 1;

    const isCorner = edge.includes("-");
    const affectsX = edge === "left" || edge === "right" || isCorner;
    const affectsY = edge === "top" || edge === "bottom" || isCorner;

    const initialWidth = Math.abs(
      (edge.includes("left") ? initialBounds.left : initialBounds.right) - anchorPoint.x,
    );
    const initialHeight = Math.abs(
      (edge.includes("top") ? initialBounds.top : initialBounds.bottom) - anchorPoint.y,
    );

    if ((affectsX && initialWidth === 0) || (affectsY && initialHeight === 0)) {
      return { sx: 1, sy: 1 };
    }

    if (affectsX) sx = newWidth / initialWidth;
    if (affectsY) sy = newHeight / initialHeight;

    if (uniform && isCorner) {
      const uniformScale = Math.max(sx, sy);
      sx = uniformScale;
      sy = uniformScale;
    }

    let flipX = false;
    let flipY = false;

    if (edge === "left" || edge === "top-left" || edge === "bottom-left") {
      flipX = currentPos.x > anchorPoint.x;
    } else if (edge === "right" || edge === "top-right" || edge === "bottom-right") {
      flipX = currentPos.x < anchorPoint.x;
    }

    if (edge === "top" || edge === "top-left" || edge === "top-right") {
      flipY = currentPos.y > anchorPoint.y;
    } else if (edge === "bottom" || edge === "bottom-left" || edge === "bottom-right") {
      flipY = currentPos.y < anchorPoint.y;
    }

    if (flipX) sx = -sx;
    if (flipY) sy = -sy;

    return { sx, sy };
  }
}

function localBoundsOfRect(rect: Rect2D): LocalBounds {
  return localBounds(Bounds.fromXYWH(rect.x, rect.y, rect.width, rect.height));
}
