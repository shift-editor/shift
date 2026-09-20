import { Bounds, Mat, Vec2, type Point2D, type Rect2D } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { DragEvent, DragStartEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { Select } from "../Select";
import type { BoundingRectEdge as NullableBoundingRectEdge } from "../cursor";
import { PositionEdits, PositionList, type ScaleEdit } from "@/lib/model/positions";
import type { ComponentTransformEdit } from "@/lib/model/ComponentTransformEdit";

type BoundingRectEdge = Exclude<NullableBoundingRectEdge, null>;

export class Resize implements SelectBehavior {
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

    let localBounds: Rect2D;
    if (componentSelection) {
      localBounds = componentSelection.bounds;
    } else if (positionSelection) {
      const positions = PositionList.fromTargetGroups(
        positionSelection.layer,
        positionSelection.targets,
      ).positions;
      const bounds = Bounds.fromPoints(positions);
      if (!bounds) return false;

      localBounds = Bounds.toRect(bounds);
    } else {
      return false;
    }

    const edge = hit.edge;
    const startPos = event.origin.scene;

    const anchorPoint = this.getAnchorPointForEdge(edge, hit.rect, event.altKey);
    const localAnchorPoint = this.getAnchorPointForEdge(edge, localBounds, event.altKey);

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
        localBounds,
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

  #cleanup(): void {
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
    const localAnchorPoint = this.getAnchorPointForEdge(
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
        const origin = this.getAnchorPointForEdge(state.resize.edge, layer.bounds, event.altKey);
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
        return { x: rect.right, y: rect.top };
      case "top-right":
        return { x: rect.left, y: rect.top };
      case "bottom-left":
        return { x: rect.right, y: rect.bottom };
      case "bottom-right":
        return { x: rect.left, y: rect.bottom };
      case "left":
        return { x: rect.right, y: center.y };
      case "right":
        return { x: rect.left, y: center.y };
      case "top":
        return { x: center.x, y: rect.top };
      case "bottom":
        return { x: center.x, y: rect.bottom };
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
      (edge.includes("top") ? initialBounds.bottom : initialBounds.top) - anchorPoint.y,
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

    if (edge === "top-left" || edge === "top-right") {
      flipY = currentPos.y < anchorPoint.y;
    } else if (edge === "bottom-left" || edge === "bottom-right") {
      flipY = currentPos.y > anchorPoint.y;
    } else if (edge === "top") {
      flipY = currentPos.y < anchorPoint.y;
    } else if (edge === "bottom") {
      flipY = currentPos.y > anchorPoint.y;
    }

    if (flipX) sx = -sx;
    if (flipY) sy = -sy;

    return { sx, sy };
  }
}
