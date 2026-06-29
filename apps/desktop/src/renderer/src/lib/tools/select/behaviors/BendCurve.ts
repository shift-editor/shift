import type { ToolContext } from "../../core/Behavior";
import type { DragEvent, DragStartEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { GlyphLayerEditDraft } from "@/lib/editor/GlyphLayerEditDraft";

export class BendCurve implements SelectBehavior {
  #draft: GlyphLayerEditDraft | null = null;
  #hasChanges = false;

  onDragStart(state: SelectState, ctx: ToolContext<SelectState>, event: DragStartEvent): boolean {
    void ctx;
    void event;
    if (state.type !== "ready" || !event.accelKey) return false;
    return false;
  }

  onDrag(state: SelectState, _ctx: ToolContext<SelectState>, event: DragEvent): boolean {
    if (state.type !== "bending") return false;
    void event;
    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "bending") return false;

    if (this.#hasChanges) {
      this.#draft?.commit();
    } else {
      this.#draft?.discard();
    }
    this.#draft = null;
    this.#hasChanges = false;

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState>): boolean {
    if (state.type !== "bending") return false;
    this.#draft?.discard();
    this.#draft = null;
    this.#hasChanges = false;
    ctx.setState({ type: "ready" });
    return true;
  }
}
