import type { Point2D, Rect2D } from "@shift/types";
import { BaseTool, type ToolName, type ToolEvent, defineStateDiagram, DrawAPI } from "../core";
import { AddContourCommand, CloseContourCommand, AddPointCommand } from "@/lib/commands";
import type { ShapeState, ShapeBehavior } from "./types";
import { ShapeReadyBehavior, ShapeDraggingBehavior } from "./behaviors";
import { DEFAULT_STYLES } from "@/lib/styles/style";

export class Shape extends BaseTool<ShapeState> {
  static stateSpec = defineStateDiagram<ShapeState["type"]>({
    states: ["idle", "ready", "dragging"],
    initial: "idle",
    transitions: [
      { from: "idle", to: "ready", event: "activate" },
      { from: "ready", to: "dragging", event: "dragStart" },
      { from: "dragging", to: "ready", event: "dragEnd" },
      { from: "ready", to: "idle", event: "deactivate" },
    ],
  });

  readonly id: ToolName = "shape";

  readonly behaviors: ShapeBehavior[] = [ShapeReadyBehavior, ShapeDraggingBehavior];

  initialState(): ShapeState {
    return { type: "idle" };
  }

  protected onStateChange(prev: ShapeState, next: ShapeState, event: ToolEvent): void {
    if (prev.type === "dragging" && next.type === "ready") {
      if (event.type === "dragEnd") {
        this.commitRectangle(prev);
      }
    }
  }

  activate(): void {
    this.state = { type: "ready" };
  }

  deactivate(): void {
    this.state = { type: "idle" };
  }

  render(draw: DrawAPI): void {
    if (this.state.type !== "dragging") return;
    const rect = this.getRect(this.state);
    if (Math.abs(rect.width) < 1 || Math.abs(rect.height) < 1) return;
    draw.rect(
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { strokeStyle: DEFAULT_STYLES.strokeStyle, strokeWidth: DEFAULT_STYLES.lineWidth },
    );
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
