import { Bounds, Mat, Vec2 } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "@/lib/editor/Editor";
import type { DragEvent, DragStartEvent, ToolEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { Select } from "../Select";
import { AngleSnap, PositionEdits, PositionList, type RotateEdit } from "@/lib/model/positions";
import type { ComponentTransformEdit } from "@/lib/model/ComponentTransformEdit";
import type { PositionCondition } from "@/types/positionEdit";

export class Rotate implements SelectBehavior {
  #edit: RotateEdit | null = null;
  #componentEdit: ComponentTransformEdit | null = null;
  #componentAngleSnap: AngleSnap | null = null;
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

  onStateEnter(
    prev: SelectState,
    next: SelectState,
    ctx: ToolContext<SelectState, Select>,
    event: ToolEvent,
  ): void {
    const editor = ctx.editor;
    if (prev.type !== "rotating" && next.type === "rotating") {
      // editor.setHandlesVisible(false);
      editor.hover.clear();
    }

    if (prev.type === "rotating" && next.type !== "rotating") {
      this.#cleanup();
      // editor.setHandlesVisible(true);
    }

    if (next.type !== "rotating" || event.type !== "drag") return;
    if (!this.#edit && !this.#componentEdit) return;

    const rawAngle = next.rotate.currentAngle - next.rotate.startAngle;
    let deltaAngle = rawAngle;
    if (this.#componentEdit) {
      deltaAngle = this.#componentAngleSnap?.apply(rawAngle) ?? rawAngle;
      this.#componentEdit.preview((layer) => {
        const center = Vec2.midpoint(
          { x: layer.bounds.left, y: layer.bounds.top },
          { x: layer.bounds.right, y: layer.bounds.bottom },
        );
        const fromOrigin = Mat.Translate(-center.x, -center.y);
        const rotation = Mat.Rotate(deltaAngle);
        const toOrigin = Mat.Translate(center.x, center.y);
        return Mat.Compose(toOrigin, Mat.Compose(rotation, fromOrigin));
      });
    } else if (this.#edit) {
      deltaAngle = this.#edit.preview(rawAngle);
    }
    ctx.setState({
      ...next,
      rotate: {
        ...next.rotate,
        currentAngle: next.rotate.startAngle + deltaAngle,
      },
    });
  }

  #cleanup(): void {
    this.#edit = null;
    this.#componentEdit = null;
    this.#componentAngleSnap = null;
    this.#done = null;
  }

  private nextRotatingState(
    state: SelectState & { type: "rotating" },
    event: DragEvent,
  ): SelectState & { type: "rotating" } {
    if (!this.#edit && !this.#componentEdit) return state;

    const currentPos = event.coords.scene;

    return {
      type: "rotating",
      rotate: {
        ...state.rotate,
        lastPos: currentPos,
        currentAngle: Vec2.angleTo(state.rotate.center, currentPos),
        shiftKey: event.shiftKey,
      },
    };
  }

  private tryStartRotate(event: DragStartEvent, editor: Editor, tool: Select): SelectState | null {
    const hit = tool.boundingBox.hit(event.origin);
    if (hit?.type !== "rotate") return null;

    const componentSelection = editor.componentTransformSelection(editor.selection.ids);
    const positionSelection = editor.positionSelection(editor.selection.ids);
    if (!componentSelection && !positionSelection) return null;

    const condition: PositionCondition = {
      when: () => {
        const state = tool.getState();
        return state.type === "rotating" && state.rotate.shiftKey;
      },
    };

    if (componentSelection) {
      this.#componentAngleSnap = AngleSnap.everyDegrees(15, condition);
      this.#componentEdit =
        componentSelection.layer.beginComponentTransformEdit(componentSelection);
    } else if (positionSelection) {
      const localPositions = PositionList.fromTargetGroups(
        positionSelection.layer,
        positionSelection.targets,
      ).positions;
      const localBounds = Bounds.fromPoints(localPositions);
      if (!localBounds) return null;

      const center = Bounds.center(localBounds);
      this.#edit = PositionEdits.fromSelection(positionSelection)
        .rotate(positionSelection.targets, center)
        .angleSnappedBy(AngleSnap.everyDegrees(15, condition));
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
        shiftKey: event.shiftKey,
      },
    };
  }
}
