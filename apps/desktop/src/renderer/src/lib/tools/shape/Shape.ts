import type { Point2D, Rect2D } from "@shift/types";
import type { IRenderer } from "@/types/graphics";
import { BaseTool, type ToolName, type ToolEvent } from "../core";
import { AddContourCommand, CloseContourCommand, AddPointCommand } from "@/lib/commands";
import { DEFAULT_STYLES } from "@/lib/styles/style";

type ShapeState =
  | { type: "idle" }
  | { type: "ready" }
  | { type: "dragging"; startPos: Point2D; currentPos: Point2D };

export class Shape extends BaseTool<ShapeState> {
  readonly id: ToolName = "shape";

  initialState(): ShapeState {
    return { type: "idle" };
  }

  transition(state: ShapeState, event: ToolEvent): ShapeState {
    switch (state.type) {
      case "idle":
        return state;

      case "ready":
        if (event.type === "dragStart") {
          return {
            type: "dragging",
            startPos: event.point,
            currentPos: event.point,
          };
        }
        return state;

      case "dragging":
        if (event.type === "drag") {
          return {
            ...state,
            currentPos: event.point,
          };
        }
        if (event.type === "dragEnd") {
          return { type: "ready" };
        }
        if (event.type === "dragCancel") {
          return { type: "ready" };
        }
        return state;

      default:
        return state;
    }
  }

  onTransition(prev: ShapeState, next: ShapeState, event: ToolEvent): void {
    if (prev.type === "dragging" && next.type === "ready") {
      if (event.type === "dragEnd") {
        this.commitRectangle(prev);
      }
    }
  }

  activate(): void {
    this.state = { type: "ready" };
    this.editor.cursor.set({ type: "crosshair" });
  }

  deactivate(): void {
    this.state = { type: "idle" };
  }

  render(renderer: IRenderer): void {
    if (this.state.type !== "dragging") return;

    const rect = this.getRect(this.state);
    if (Math.abs(rect.width) < 1 || Math.abs(rect.height) < 1) return;

    renderer.save();
    renderer.setStyle({
      ...DEFAULT_STYLES,
      fillStyle: "transparent",
    });
    renderer.strokeRect(rect.x, rect.y, rect.width, rect.height);
    renderer.restore();
  }

  private getRect(state: { startPos: Point2D; currentPos: Point2D }): Rect2D {
    const width = state.currentPos.x - state.startPos.x;
    const height = state.currentPos.y - state.startPos.y;

    return {
      x: state.startPos.x,
      y: state.startPos.y,
      width,
      height,
      left: Math.min(state.startPos.x, state.currentPos.x),
      top: Math.min(state.startPos.y, state.currentPos.y),
      right: Math.max(state.startPos.x, state.currentPos.x),
      bottom: Math.max(state.startPos.y, state.currentPos.y),
    };
  }

  private commitRectangle(state: { startPos: Point2D; currentPos: Point2D }): void {
    const rect = this.getRect(state);
    if (Math.abs(rect.width) < 3 || Math.abs(rect.height) < 3) return;

    this.editor.commands.beginBatch("Draw Rectangle");

    this.editor.commands.execute(new AddPointCommand(rect.x, rect.y, "onCurve", false));
    this.editor.commands.execute(
      new AddPointCommand(rect.x + rect.width, rect.y, "onCurve", false),
    );
    this.editor.commands.execute(
      new AddPointCommand(rect.x + rect.width, rect.y + rect.height, "onCurve", false),
    );
    this.editor.commands.execute(
      new AddPointCommand(rect.x, rect.y + rect.height, "onCurve", false),
    );
    this.editor.commands.execute(new CloseContourCommand());
    this.editor.commands.execute(new AddContourCommand());

    this.editor.commands.endBatch();
  }
}
