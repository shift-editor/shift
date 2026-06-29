import type { ToolContext } from "../../core/Behavior";
import type { DragEvent, DragStartEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { Select } from "../Select";

export class Resize implements SelectBehavior {
  onDragStart(
    _state: SelectState,
    ctx: ToolContext<SelectState, Select>,
    event: DragStartEvent,
  ): boolean {
    if (!ctx.editor.selection.hasSelection()) return false;

    void ctx;
    void event;
    return false;
  }

  onDrag(state: SelectState, ctx: ToolContext<SelectState, Select>, event: DragEvent): boolean {
    void state;
    void ctx;
    void event;
    return false;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "resizing") return false;

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "resizing") return false;

    ctx.setState({ type: "ready" });
    return true;
  }

  onStateEnter(prev: SelectState, next: SelectState, ctx: ToolContext<SelectState, Select>): void {
    const editor = ctx.editor;
    if (prev.type !== "resizing" && next.type === "resizing") {
      editor.hover.clear();
    }
  }
}
