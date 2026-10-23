import type {
  ClickEvent,
  DoubleClickEvent,
  DragEndEvent,
  DragEvent,
  DragStartEvent,
  KeyDownEvent,
} from "../../core/GestureDetector";
import type { ToolContext } from "../../core/Behavior";
import type { TextBehavior, TextState } from "../types";
import type { ScenePoint } from "../../../../types/coordinates";
import { Bounds } from "@shift/geo";
import type { NodeId } from "@shift/types";
import type { TextRunNode } from "../../../../types/node";
import type { Sizing } from "../../../../types/frame";
import type { Editor } from "../../../editor/Editor";

/**
 * Places text boxes and types into them.
 *
 * @remarks
 * Clicking a text box places the caret in it, starting to edit it when
 * another box was being edited. Clicking empty canvas places a new box that
 * hugs its text, with its top-left corner at the pointer; dragging there
 * draws a box of the dragged width, whose lines wrap; dragged down at least
 * an em, its height is fixed too. Dragging inside the
 * edited box selects text. Escape leaves for the Select tool with the box
 * selected, unless a glyph edited in place takes back over. A box placed here and left empty is removed when it is left.
 */
export class TypingBehavior implements TextBehavior {
  /** The box being drawn by a drag on empty canvas, and where the drag began. */
  #drawing: { readonly nodeId: NodeId; readonly origin: ScenePoint } | null = null;
  // non-reactive: boxes this tool placed, which leaving removes while they are empty
  readonly #placed = new Set<NodeId>();

  /** Leaves the box being edited: removes it when this tool placed it and it is still empty. */
  leave(editor: Editor): void {
    const nodeId = editor.textEditing.state?.nodeId ?? null;
    if (!nodeId || !this.#placed.has(nodeId)) return;

    this.#placed.delete(nodeId);
    editor.history.captureOrJoin("Remove empty text", () => removeEmptyBox(editor, nodeId));
  }

  onClick(state: TextState, ctx: ToolContext<TextState>, event: ClickEvent): boolean {
    return this.#click(state, ctx, event);
  }

  onDoubleClick(state: TextState, ctx: ToolContext<TextState>, event: DoubleClickEvent): boolean {
    return this.#click(state, ctx, event);
  }

  #click(
    state: TextState,
    ctx: ToolContext<TextState>,
    event: ClickEvent | DoubleClickEvent,
  ): boolean {
    if (state.type === "idle") return false;
    const point = event.coords.scene;
    if (!boxAt(ctx, point)) {
      this.#placeBox(ctx, point, { kind: "hug" });
      return true;
    }

    const caret = this.#caretAt(ctx, point);
    if (!caret) return false;
    ctx.editor.textEditing.placeAtCluster(caret.cluster, event.shiftKey);
    ctx.setState({ type: "editing" });
    return true;
  }

  onDragStart(state: TextState, ctx: ToolContext<TextState>, event: DragStartEvent): boolean {
    if (state.type === "idle") return false;
    const origin = event.origin.scene;
    if (!boxAt(ctx, origin)) {
      const node = this.#placeBox(ctx, origin, { kind: "fixed", size: 0 });
      this.#drawing = { nodeId: node.id, origin };
      return true;
    }

    const caret = this.#caretAt(ctx, origin);
    if (!caret) return false;
    ctx.editor.textEditing.placeAtCluster(caret.cluster);
    ctx.setState({ type: "editing" });
    return true;
  }

  onDrag(state: TextState, ctx: ToolContext<TextState>, event: DragEvent): boolean {
    if (state.type !== "editing") return false;
    const editor = ctx.editor;
    const point = event.coords.scene;
    if (this.#drawing) {
      const { nodeId, origin } = this.#drawing;
      editor.history.captureOrJoin("Add text", () =>
        editor.scene.updateNode({
          id: nodeId,
          ...drawnBox(origin, point, editor.text.newBoxSize),
        }),
      );
      return true;
    }

    const caret = this.#caretAt(ctx, point);
    if (!caret) return false;
    editor.textEditing.placeAtCluster(caret.cluster, true);
    return true;
  }

  onDragEnd(_state: TextState, _ctx: ToolContext<TextState>, _event: DragEndEvent): boolean {
    if (!this.#drawing) return false;
    this.#drawing = null;
    return true;
  }

  onKeyDown(state: TextState, ctx: ToolContext<TextState>, event: KeyDownEvent): boolean {
    if (state.type === "idle" || event.key !== "Escape") return false;
    const editor = ctx.editor;
    const nodeId = editor.textEditing.state?.nodeId ?? null;
    editor.setActiveTool("select");
    // Back to a glyph edited in place, the glyph stays the context. Otherwise
    // select the box; leaving text is navigation, so undo still undoes the typing.
    if (nodeId && editor.scene.node(nodeId) && !editor.editing.hasScope()) {
      editor.history.withoutRecording(() => editor.selection.select([nodeId]));
    }
    return true;
  }

  /**
   * Leaves the box being edited, places a new empty box with its top-left
   * corner at `point`, and edits it.
   */
  #placeBox(ctx: ToolContext<TextState>, point: ScenePoint, width: Sizing): TextRunNode {
    const size = ctx.editor.text.newBoxSize;
    const editor = ctx.editor;
    this.leave(editor);
    const node = editor.history.captureOrJoin("Add text", () =>
      editor.scene.createNode<TextRunNode>({
        kind: "textRun",
        runId: editor.text.createRun([]).id,
        size,
        width,
        height: { kind: "hug" },
        rotation: 0,
        position: { x: point.x, y: point.y },
      }),
    );
    this.#placed.add(node.id);
    editor.textEditing.begin(node.id);
    ctx.setState({ type: "editing" });
    return node;
  }

  /**
   * Returns the caret cluster at a scene point in the box under it, starting
   * to edit that box when it is not the one being edited.
   */
  #caretAt(ctx: ToolContext<TextState>, point: ScenePoint): { cluster: number } | null {
    const editor = ctx.editor;
    const edited = editor.scene.nodeOfKind(editor.textEditing.state?.nodeId ?? null, "textRun");
    const run = boxAt(ctx, point) ?? edited;
    if (!run) return null;
    if (run.id !== edited?.id) {
      this.leave(editor);
      editor.textEditing.begin(run.id);
      editor.text.rememberBoxSize(run.size);
    }
    const cluster = editor.nodeDefinition("textRun").caretAt(run, editor.toLocal(run, point));
    return cluster === null ? null : { cluster };
  }
}

/** The text box under a scene point on the active page, topmost first; null over empty canvas. */
function boxAt(ctx: ToolContext<TextState>, point: ScenePoint): TextRunNode | null {
  const editor = ctx.editor;
  const runs = editor.nodeDefinition("textRun");
  const nodes = editor.scene.nodesOfKind("textRun");
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index]!;
    const bounds = runs.bounds(node);
    const reach = editor.hitRadiusIn(node);
    if (bounds && Bounds.containsPoint(Bounds.expand(bounds, reach), editor.toLocal(node, point))) {
      return node;
    }
  }
  return null;
}

/** Deletes a text box and its run when the run has no text, as leaving an empty box does. */
function removeEmptyBox(editor: Editor, nodeId: NodeId | null): void {
  const node = editor.scene.nodeOfKind(nodeId, "textRun");
  if (!node || editor.text.items(node).length > 0) return;

  editor.scene.deleteNode(node.id);
  if (editor.scene.nodesReferencing(node.runId).length === 0) editor.text.deleteRun(node.runId);
}

/**
 * The box a drag from `origin` to `point` draws: the dragged width, and the
 * dragged height once it reaches an em (`size`); less hugs the text.
 */
function drawnBox(
  origin: ScenePoint,
  point: ScenePoint,
  size: number,
): Pick<TextRunNode, "position" | "width" | "height"> {
  const height = Math.abs(point.y - origin.y);
  return {
    position: { x: Math.min(origin.x, point.x), y: Math.min(origin.y, point.y) },
    width: { kind: "fixed", size: Math.abs(point.x - origin.x) },
    height: height >= size ? { kind: "fixed", size: height } : { kind: "hug" },
  };
}
