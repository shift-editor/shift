import type { Point2D, Rect2D } from "@shift/types";
import { BaseTool, type ToolName, type ToolEvent, defineStateDiagram } from "../core";
import type { ShapeState } from "./types";
import { ShapeReadyBehavior, ShapeDraggingBehavior } from "./behaviors";
import type { Canvas } from "@/lib/editor/rendering/Canvas";

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

  readonly behaviors = [ShapeReadyBehavior, ShapeDraggingBehavior];

  initialState(): ShapeState {
    return { type: "idle" };
  }

  protected override onStateChange(prev: ShapeState, next: ShapeState, event: ToolEvent): void {
    if (prev.type === "dragging" && next.type === "ready") {
      if (event.type === "dragEnd") {
        this.commitRectangle(prev);
      }
    }
  }

  override activate(): void {
    this.state = { type: "ready" };
  }

  override deactivate(): void {
    this.state = { type: "idle" };
  }

  override renderOverlay(canvas: Canvas): void {
    if (this.state.type !== "dragging") return;
    const rect = this.getRect(this.state);
    if (Math.abs(rect.width) < 1 || Math.abs(rect.height) < 1) return;
    canvas.strokeRect(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      canvas.theme.glyph.stroke,
      canvas.theme.glyph.widthPx,
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

    const glyph = this.editor.glyph.peek();
    if (!glyph) return;

    this.batch("Draw Rectangle", () => {
      const contourId = glyph.addContour();

      const edit = (x: number, y: number) => ({
        x,
        y,
        pointType: "onCurve" as const,
        smooth: false,
      });

      glyph.addPointToContour(contourId, edit(rect.x, rect.y));
      glyph.addPointToContour(contourId, edit(rect.x + rect.width, rect.y));
      glyph.addPointToContour(contourId, edit(rect.x + rect.width, rect.y + rect.height));
      glyph.addPointToContour(contourId, edit(rect.x, rect.y + rect.height));
      glyph.closeContour();
    });
  }
}
