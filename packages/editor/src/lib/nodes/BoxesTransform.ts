import { Bounds, type Rect2D } from "@shift/geo";
import type { Editor } from "../editor/Editor";
import type { ShiftNode } from "../../types/node";
import type { TransformAction, TransformEdit, TransformTarget } from "../../types/transformTarget";

/**
 * Moves several boxes (text boxes and frames) on one page together.
 *
 * @remarks
 * Works in scene units, the page's own: its bounds are the boxes' combined
 * scene box, and a move shifts every box's position by the same amount.
 * Only moving is supported ({@link moveOnly}): resizing or turning a group
 * of boxes does nothing yet. Every preview writes the node records, so a
 * gesture's capture makes the drag one undo step.
 */
export class BoxesTransform implements TransformTarget {
  readonly moveOnly = true;
  readonly #editor: Editor;
  readonly #nodes: readonly ShiftNode[];

  /**
   * @param nodes - boxes whose parent is the same page.
   * @param bounds - their combined scene box.
   */
  constructor(
    editor: Editor,
    nodes: readonly ShiftNode[],
    readonly bounds: Rect2D,
  ) {
    this.#editor = editor;
    this.#nodes = nodes;
  }

  /** The transform for several boxes on one page, or null when `nodes` are not that. */
  static forNodes(editor: Editor, nodes: readonly ShiftNode[]): BoxesTransform | null {
    if (nodes.length < 2) return null;
    const pageId = nodes[0]!.parentId;
    const onOnePage = nodes.every(
      (node) =>
        editor.nodeDefinition(node.kind).selectable &&
        node.parentId === pageId &&
        editor.scene.parent(node.id)?.kind === "page",
    );
    const bounds = Bounds.unionAll(nodes.map((node) => editor.nodeBounds(node)));
    if (!onOnePage || !bounds) return null;

    return new BoxesTransform(editor, nodes, Bounds.toRect(bounds));
  }

  begin(action: TransformAction): TransformEdit {
    const editor = this.#editor;
    const nodes = this.#nodes;
    const write = (offset: { x: number; y: number }) =>
      editor.history.captureOrJoin("Move boxes", () => {
        for (const node of nodes) {
          editor.scene.updateNode({
            id: node.id,
            position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
          });
        }
      });

    return {
      preview: (deltaFor) => {
        if (action !== "move") return;
        const delta = deltaFor({ bounds: this.bounds });
        write({ x: delta.e, y: delta.f });
      },
      // Previews already wrote the records inside the gesture's capture.
      commit: () => {},
      discard: () => write({ x: 0, y: 0 }),
    };
  }
}
