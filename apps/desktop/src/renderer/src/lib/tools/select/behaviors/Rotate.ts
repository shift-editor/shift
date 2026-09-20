import { Bounds, Vec2 } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "@/lib/editor/Editor";
import type { DragEvent, DragStartEvent, ToolEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { Select } from "../Select";
import { AngleSnap, PositionEdits, PositionList, type RotateEdit } from "@/lib/model/positions";
import type { PositionCondition } from "@/types/positionEdit";

export class Rotate implements SelectBehavior {
  #edit: RotateEdit | null = null;
  #done: (() => void) | null = null;

  onDragStart(
    _state: SelectState,
    ctx: ToolContext<SelectState, Select>,
    event: DragStartEvent,
  ): boolean {
    if (!ctx.editor.selection.hasSelection()) return false;

    const next = this.tryStartRotate(event, ctx.editor, ctx.tool);
    const edit = this.#edit;
    if (!next || !edit) return false;

    this.#done = ctx.onCancel(() => edit.discard());
    ctx.setState(next);
    return true;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState, Select>, event: DragEvent): boolean {
    if (state.type !== "rotating") return false;
    if (!this.#edit) return false;

    const next = this.nextRotatingState(state, event);
    ctx.setState(next);

    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "rotating") return false;

    this.#edit?.commit();
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

    if (next.type !== "rotating" || event.type !== "drag" || !this.#edit) return;

    const deltaAngle = this.#edit.preview(next.rotate.currentAngle - next.rotate.startAngle);
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
    this.#done = null;
  }

  private nextRotatingState(
    state: SelectState & { type: "rotating" },
    event: DragEvent,
  ): SelectState & { type: "rotating" } {
    if (!this.#edit) return state;

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

    const selection = editor.positionSelection(editor.selection.ids);
    if (!selection) return null;

    const localPositions = PositionList.fromTargetGroups(
      selection.layer,
      selection.targets,
    ).positions;
    const localBounds = Bounds.fromPoints(localPositions);
    if (!localBounds) return null;

    const corner = hit.corner;
    const localCenter = Bounds.center(localBounds);
    const center = hit.center;
    const startAngle = Vec2.angleTo(center, event.origin.scene);

    const condition: PositionCondition = {
      when: () => {
        const state = tool.getState();
        return state.type === "rotating" && state.rotate.shiftKey;
      },
    };
    this.#edit = PositionEdits.fromSelection(selection)
      .rotate(selection.targets, localCenter)
      .angleSnappedBy(AngleSnap.everyDegrees(15, condition));

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
