import type { Point2D, Rect2D } from "@shift/geo";
import type { ContourId, PointId } from "@shift/types";
import { BaseTool, type ToolName } from "../core";
import type { ToolContext } from "../core/Behavior";
import type { Shape, ShapeKind, ShapeState } from "./types";
import { ShapeReadyBehavior, ShapeDraggingBehavior } from "./behaviors";
import { Ellipse } from "./Ellipse";
import { Rectangle } from "./Rectangle";
import type { Editor } from "@/lib/editor/Editor";
import type { GlyphLayerEdit } from "@/lib/model/GlyphLayerEdit";
import { batch, type Signal } from "@/lib/signals";
import type { CursorType } from "@/types/editor";

export class ShapeTool extends BaseTool<ShapeState, ShapeTool> {
  readonly id: ToolName = "shape";
  readonly behaviors = [ShapeReadyBehavior, ShapeDraggingBehavior];
  readonly #shapeKindCell: Signal<ShapeKind>;
  #edit: GlyphLayerEdit | null = null;
  #shape: Shape | null = null;
  #contourId: ContourId | null = null;
  #pointIds: readonly PointId[] = [];
  #origin: Point2D = { x: 0, y: 0 };
  #done: (() => void) | null = null;

  constructor(editor: Editor, shapeKindCell: Signal<ShapeKind>) {
    super(editor);
    this.#shapeKindCell = shapeKindCell;
  }

  initialState(): ShapeState {
    return { type: "idle" };
  }

  override getCursor(): CursorType {
    switch (this.#shapeKindCell.value) {
      case "rectangle":
        return { type: "crosshair-square" };
      case "ellipse":
        return { type: "crosshair-circle" };
    }
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

  /**
   * Creates a selected, locally editable contour owned by the active drag.
   *
   * @param state - Initial drag coordinates in scene space.
   * @param ctx - Drag scope that owns rollback and handle-visibility cleanup.
   * @returns False when there is no single editable glyph layer.
   */
  beginShape(state: ShapeState, ctx: ToolContext<ShapeState, ShapeTool>): boolean {
    const nodes = this.editor.scene.nodesOfKind("glyph");
    if (nodes.length !== 1) return false;

    const [node] = nodes;
    if (!node) return false;

    const layer = this.editor.glyphForId(node.glyphId)?.layerForSource(node.sourceId);
    if (!layer || this.editor.sessionMode === "preview") return false;

    this.#origin = node.position;
    const rect = this.getRect(state);
    if (!rect) return false;

    switch (this.#shapeKindCell.peek()) {
      case "rectangle":
        this.#shape = new Rectangle();
        break;
      case "ellipse":
        this.#shape = new Ellipse();
        break;
    }

    const points = this.#shape.createPoints(rect);
    const selection = this.editor.selection.ids;
    const edit = layer.beginEdit();
    this.#edit = edit;
    this.#done = ctx.onCancel(() => {
      try {
        edit.cancel();
      } finally {
        this.editor.selection.select(selection);
        this.#edit = null;
        this.#shape = null;
        this.#contourId = null;
        this.#pointIds = [];
        this.#done = null;
      }
    });

    batch(() => {
      const contourId = edit.addContour(true);
      this.#contourId = contourId;
      const showHandles = this.editor.hideHandles(contourId);
      ctx.onCancel(showHandles);
      this.#pointIds = edit.addPoints(contourId, points);
      this.editor.selection.select([contourId]);
    });

    return true;
  }

  /**
   * Updates the live contour without sending edits to the workspace.
   *
   * @param state - Current scene-space drag, including its original pointer-down position.
   */
  previewShape(state: ShapeState): void {
    if (!this.#edit || !this.#shape) return;
    const rect = this.getRect(state);
    if (!rect) return;

    const points = this.#shape.createPoints(rect);
    this.#edit.setPositions(
      points.map((point, index) => ({
        kind: "point",
        id: this.#pointIds[index],
        x: point.x,
        y: point.y,
      })),
    );
  }

  private getRect(state: ShapeState): Rect2D | null {
    if (state.type !== "dragging") return null;

    let width = state.currentPos.x - state.startPos.x;
    let height = state.currentPos.y - state.startPos.y;

    if (this.editor.currentModifiers.shiftKey) {
      const size = Math.max(Math.abs(width), Math.abs(height));
      width = width < 0 ? -size : size;
      height = height < 0 ? -size : size;
    }

    const x = state.startPos.x - this.#origin.x;
    const y = state.startPos.y - this.#origin.y;

    return {
      x,
      y,
      width,
      height,
      left: Math.min(x, x + width),
      top: Math.min(y, y + height),
      right: Math.max(x, x + width),
      bottom: Math.max(y, y + height),
    };
  }

  /**
   * Finishes the selected draft as one undoable glyph edit.
   *
   * @param state - Final drag coordinates used for the minimum-size check.
   * @returns The retained contour ID, or undefined when drag cleanup should discard the draft.
   */
  commitShape(state: ShapeState): ContourId | undefined {
    if (!this.#edit || !this.#shape || !this.#contourId) return;
    const rect = this.getRect(state);
    if (!rect || Math.abs(rect.width) < 3 || Math.abs(rect.height) < 3) return;

    this.previewShape(state);
    this.#edit.finish(`Draw ${this.#shape.label}`);
    if (this.#done) this.#done();
    this.#edit = null;

    return this.#contourId;
  }
}
