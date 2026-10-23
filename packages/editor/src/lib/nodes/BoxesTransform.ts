import { Bounds, Mat, type MatModel, type Rect2D } from "@shift/geo";
import type { Editor } from "../editor/Editor";
import type { ShiftNode } from "../../types/node";
import type { Sizing } from "../../types/frame";
import type { TransformAction, TransformEdit, TransformTarget } from "../../types/transformTarget";

/** Smallest change in a side, in scene units, that counts as resizing it. */
const RESIZE_EPSILON = 1e-6;

/** What a group transform writes to one box. */
type BoxUpdate = Partial<{
  position: { x: number; y: number };
  width: Sizing;
  height: Sizing;
  rotation: number;
}>;

/**
 * Moves, resizes, and turns several boxes (text boxes and frames) on one page together.
 *
 * @remarks
 * Works in scene units, the page's own: its bounds are the boxes' combined
 * scene box. Moving shifts every box. Resizing carries each box with the
 * group and fixes a box's side at its new length only where that side grew
 * or shrank, so text wraps again but its size never changes; a turned box is
 * only carried. Turning carries each box around the pivot and turns each
 * text box by the same angle (frames do not turn). Every preview writes the
 * node records, so a gesture's capture makes the drag one undo step.
 */
export class BoxesTransform implements TransformTarget {
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
    const boxes = nodes.map((node) => ({ node, bounds: editor.nodeBounds(node) }));
    const write = (updateFor: (node: ShiftNode, bounds: Bounds | null) => BoxUpdate) =>
      editor.history.captureOrJoin("Transform boxes", () => {
        for (const { node, bounds } of boxes) {
          editor.scene.updateNode({ id: node.id, ...updateFor(node, bounds) });
        }
      });

    return {
      preview: (deltaFor) => {
        const delta = deltaFor({ bounds: this.bounds });
        switch (action) {
          case "move":
            write((node) => ({ position: moved(node.position, delta) }));
            return;
          case "scale":
            write((node, bounds) => scaled(node, bounds, delta));
            return;
          case "rotate":
            write((node) => turned(node, delta));
            return;
        }
      },
      // Previews already wrote the records inside the gesture's capture.
      commit: () => {},
      discard: () => write((node) => original(node)),
    };
  }
}

/** A point carried by a delta's translation only. */
function moved(position: { x: number; y: number }, delta: MatModel): { x: number; y: number } {
  return { x: position.x + delta.e, y: position.y + delta.f };
}

/** A box carried with a resized group; its sides fixed where they changed. */
function scaled(node: ShiftNode, bounds: Bounds | null, delta: MatModel): BoxUpdate {
  const turnedBox = node.kind === "textRun" && node.rotation !== 0;
  if (!bounds || turnedBox) return { position: Mat.applyToPoint(delta, node.position) };

  const next = Bounds.fromPoints([
    Mat.applyToPoint(delta, bounds.min),
    Mat.applyToPoint(delta, bounds.max),
  ]);
  if (!next) return {};

  const update: BoxUpdate = { position: { x: next.min.x, y: next.min.y } };
  if (node.kind !== "textRun" && node.kind !== "frame") return update;
  return {
    ...update,
    width: resized(node.width, Bounds.width(bounds), Bounds.width(next)),
    height: resized(node.height, Bounds.height(bounds), Bounds.height(next)),
  };
}

/** A box carried around the pivot; a text box also turns by the delta's angle. */
function turned(node: ShiftNode, delta: MatModel): BoxUpdate {
  const position = Mat.applyToPoint(delta, node.position);
  if (node.kind !== "textRun") return { position };
  return { position, rotation: node.rotation + Math.atan2(delta.b, delta.a) };
}

/** What a box had before the gesture, to restore on discard. */
function original(node: ShiftNode): BoxUpdate {
  const update: BoxUpdate = { position: node.position };
  if (node.kind === "frame") return { ...update, width: node.width, height: node.height };
  if (node.kind !== "textRun") return update;
  return { ...update, width: node.width, height: node.height, rotation: node.rotation };
}

/** A side's sizing after a resize: fixed at the new length when it changed, else as it was. */
function resized(sizing: Sizing, before: number, after: number): Sizing {
  if (Math.abs(after - before) <= RESIZE_EPSILON) return sizing;
  return { kind: "fixed", size: Math.max(0, after) };
}
