import { Bounds, Mat, Vec2, type Point2D } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "@/lib/editor/Editor";
import type { DragEvent, DragStartEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { Select } from "../Select";
import { PositionList, type RotateEdit } from "@/lib/model/positions";
import type { ComponentTransformEdit } from "@/lib/model/ComponentTransformEdit";
import { selectedComponentObjects } from "../componentSelection";

export class Rotate implements SelectBehavior {
  #edit: RotateEdit | null = null;
  #componentEdit: ComponentTransformEdit | null = null;
  #componentCenter: Point2D = { x: 0, y: 0 };
  #done: (() => void) | null = null;

  onDragStart(
    _state: SelectState,
    ctx: ToolContext<SelectState, Select>,
    event: DragStartEvent,
  ): boolean {
    if (!ctx.editor.selection.hasSelection()) return false;

    const next = this.tryStartRotate(event, ctx.editor, ctx.tool);
    if (!next || (!this.#edit && !this.#componentEdit)) return false;

    const edit = this.#edit;
    const componentEdit = this.#componentEdit;
    this.#done = ctx.onCancel(() => {
      edit?.discard();
      componentEdit?.discard();
    });
    ctx.setState(next);
    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState, Select>, event: DragEvent): boolean {
    if (state.type !== "rotating") return false;
    if (!this.#edit && !this.#componentEdit) return false;

    const next = this.nextRotatingState(state, event);
    ctx.setState(next);

    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "rotating") return false;

    this.#edit?.commit();
    this.#componentEdit?.commit("Rotate components");
    if (this.#done) this.#done();
    this.#cleanup();

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "rotating") return false;

    this.#cleanup();

    ctx.setState({ type: "ready" });
    return true;
  }

  onStateEnter(prev: SelectState, next: SelectState, ctx: ToolContext<SelectState, Select>): void {
    const editor = ctx.editor;
    if (prev.type !== "rotating" && next.type === "rotating") {
      // editor.setHandlesVisible(false);
      editor.hover.clear();
    }

    if (prev.type === "rotating" && next.type !== "rotating") {
      this.#cleanup();
      // editor.setHandlesVisible(true);
    }
  }

  #cleanup(): void {
    this.#edit = null;
    this.#componentEdit = null;
    this.#componentCenter = { x: 0, y: 0 };
    this.#done = null;
  }

  private nextRotatingState(
    state: SelectState & { type: "rotating" },
    event: DragEvent,
  ): SelectState & { type: "rotating" } {
    if (!this.#edit && !this.#componentEdit) return state;

    const currentPos = event.coords.scene;
    const rawAngle = Vec2.angleTo(state.rotate.center, currentPos);
    const angle = rawAngle - state.rotate.startAngle;
    let deltaAngle = angle;
    if (this.#componentEdit) {
      const fromOrigin = Mat.Translate(-this.#componentCenter.x, -this.#componentCenter.y);
      const rotation = Mat.Rotate(angle);
      const toOrigin = Mat.Translate(this.#componentCenter.x, this.#componentCenter.y);
      this.#componentEdit.preview(Mat.Compose(toOrigin, Mat.Compose(rotation, fromOrigin)));
    } else if (this.#edit) {
      deltaAngle = this.#edit.preview(angle);
    }
    const currentAngle = state.rotate.startAngle + deltaAngle;

    return {
      type: "rotating",
      rotate: {
        ...state.rotate,
        lastPos: currentPos,
        currentAngle,
      },
    };
  }

  private tryStartRotate(event: DragStartEvent, editor: Editor, tool: Select): SelectState | null {
    const hit = tool.boundingBox.hit(event.origin);
    if (hit?.type !== "rotate") return null;

    const components = selectedComponentObjects(editor);
    const componentLayer = components[0]?.layer;
    const componentNode = components[0]?.node;
    const selection = editor.positionSelection(editor.selection.ids);
    if (!componentLayer && !selection) return null;

    let localCenter: Point2D;
    if (componentLayer && componentNode) {
      localCenter = Vec2.sub(hit.center, componentNode.position);
      this.#componentCenter = localCenter;
      this.#componentEdit = componentLayer.beginComponentTransformEdit(
        components.map((component) => component.componentId),
      );
    } else if (selection) {
      const localPositions = PositionList.fromTargetGroups(
        selection.layer,
        selection.targets,
      ).positions;
      const localBounds = Bounds.fromPoints(localPositions);
      if (!localBounds) return null;

      localCenter = Bounds.center(localBounds);
      this.#edit = selection.layer.positions.rotate(selection.targets, localCenter);
    } else {
      return null;
    }

    const corner = hit.corner;
    const center = hit.center;
    const startAngle = Vec2.angleTo(center, event.origin.scene);

    return {
      type: "rotating",
      rotate: {
        corner,
        startPos: event.origin.scene,
        lastPos: event.origin.scene,
        center,
        startAngle,
        currentAngle: startAngle,
      },
    };
  }
}
