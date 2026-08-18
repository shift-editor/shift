import { Bounds, Vec2 } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "@/lib/editor/Editor";
import type { DragEvent, DragStartEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { Select } from "../Select";
import type { RotateEdit } from "@/lib/model/positions";
import { GlyphLayerPositionList } from "@/lib/model/GlyphLayerPositionList";

export class Rotate implements SelectBehavior {
  #edit: RotateEdit | null = null;

  onDragStart(
    _state: SelectState,
    ctx: ToolContext<SelectState, Select>,
    event: DragStartEvent,
  ): boolean {
    if (!ctx.editor.selection.hasSelection()) return false;

    const next = this.tryStartRotate(event, ctx.editor, ctx.tool);
    if (!next) return false;

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
    this.#cleanup();

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "rotating") return false;

    this.#edit?.discard();
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
  }

  private nextRotatingState(
    state: SelectState & { type: "rotating" },
    event: DragEvent,
  ): SelectState & { type: "rotating" } {
    if (!this.#edit) return state;

    const currentPos = event.coords.scene;
    const rawAngle = Vec2.angleTo(state.rotate.center, currentPos);
    const deltaAngle = this.#edit.preview(rawAngle - state.rotate.startAngle);
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

    const selection = editor.positionSelection(editor.selection.ids);
    if (!selection) return null;

    const localPositions = GlyphLayerPositionList.fromTargetGroups(
      selection.layer,
      selection.targets,
    ).positions;
    const localBounds = Bounds.fromPoints(localPositions);
    if (!localBounds) return null;

    const corner = hit.corner;
    const localCenter = Bounds.center(localBounds);
    const center = hit.center;
    const startAngle = Vec2.angleTo(center, event.origin.scene);

    this.#edit = selection.layer.positions.rotate(selection.targets, localCenter);

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
