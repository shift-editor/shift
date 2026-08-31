import { Vec2, type Point2D, type Rect2D } from "@shift/geo";
import { Point } from "@shift/glyph-state";
import type { ContourId } from "@shift/types";
import { BaseTool, type ToolName } from "../core";
import type { ShapeKind, ShapeState } from "./types";
import { ShapeReadyBehavior, ShapeDraggingBehavior } from "./behaviors";
import type { Editor } from "@/lib/editor/Editor";
import type { Canvas } from "@/lib/editor/rendering/Canvas";
import type { Signal } from "@/lib/signals";
import type { CursorType } from "@/types/editor";

export class Shape extends BaseTool<ShapeState, Shape> {
  readonly id: ToolName = "shape";

  readonly behaviors = [ShapeReadyBehavior, ShapeDraggingBehavior];
  readonly #shapeKindCell: Signal<ShapeKind>;

  constructor(editor: Editor, shapeKindCell: Signal<ShapeKind>) {
    super(editor);
    this.#shapeKindCell = shapeKindCell;
  }

  initialState(): ShapeState {
    return { type: "idle" };
  }

  protected override preTransition(state: ShapeState): { state: ShapeState } | null {
    if (this.#shapeKindCell.peek() === "circle") return { state };

    return null;
  }

  override getCursor(): CursorType {
    return { type: "crosshair" };
  }

  protected override isEditing(state: ShapeState): boolean {
    return state.type === "dragging";
  }

  override activate(): void {
    this.setState({ type: "ready" });
  }

  override deactivate(): void {
    this.setState({ type: "idle" });
  }

  override drawOverlay(canvas: Canvas): void {
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

  /**
   * Commits the dragged rectangle as one undoable glyph transaction.
   *
   * @param state - Completed drag coordinates used to derive the rectangle bounds.
   */
  commitShape(state: { startPos: Point2D; currentPos: Point2D }): ContourId | undefined {
    const rect = this.getRect(state);
    if (Math.abs(rect.width) < 3 || Math.abs(rect.height) < 3) return;

    const glyphNodes = this.editor.scene.nodesOfKind("glyph");
    if (glyphNodes.length !== 1) return;

    const [node] = glyphNodes;
    if (!node) return;

    const layer = this.editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId);
    if (!layer) return;

    return this.editor.transaction("Draw rectangle", () => {
      const contourId = layer.addContour();
      const origin = Vec2.create(rect.x, rect.y);
      const topLeft = origin;
      const topRight = Vec2.add(origin, Vec2.create(rect.width, 0));
      const bottomRight = Vec2.add(origin, Vec2.create(rect.width, rect.height));
      const bottomLeft = Vec2.add(origin, Vec2.create(0, rect.height));

      layer.addPoint(contourId, Point.onCurve(topLeft));
      layer.addPoint(contourId, Point.onCurve(topRight));
      layer.addPoint(contourId, Point.onCurve(bottomRight));
      layer.addPoint(contourId, Point.onCurve(bottomLeft));
      layer.closeContour(contourId);

      return contourId;
    });
  }
}
