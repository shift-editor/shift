import type { Point2D } from "@shift/geo";
import type { ToolContext } from "../../core/Behavior";
import type { Editor } from "@/lib/editor/Editor";
import type { DragEvent, DragStartEvent } from "../../core/GestureDetector";
import type { SelectBehavior, SelectState } from "../types";
import type { GlyphLayerEditDraft } from "@/lib/editor/GlyphLayerEditDraft";
import type { Select } from "../Select";

export class Rotate implements SelectBehavior {
  #draft: GlyphLayerEditDraft | null = null;
  #origin: Point2D | null = null;

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
    if (!this.#draft || !this.#origin) return false;

    const next = this.nextRotatingState(state, event);
    ctx.setState(next);

    return true;
  }

  onDragEnd(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "rotating") return false;

    this.#draft?.commit();
    this.#cleanup();

    ctx.setState({ type: "ready" });
    return true;
  }

  onDragCancel(state: SelectState, ctx: ToolContext<SelectState, Select>): boolean {
    if (state.type !== "rotating") return false;

    this.#draft?.discard();
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
    this.#draft = null;
    this.#origin = null;
  }

  private nextRotatingState(
    state: SelectState & { type: "rotating" },
    event: DragEvent,
  ): SelectState & { type: "rotating" } {
    void event;
    return {
      type: "rotating",
      rotate: {
        ...state.rotate,
      },
    };
  }

  private tryStartRotate(event: DragStartEvent, editor: Editor, tool: Select): SelectState | null {
    void event;
    void editor;
    void tool;
    return null;
  }
}
