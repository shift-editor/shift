import type { NodeId } from "@shift/types";
import { Bounds, Mat, type MatModel } from "@shift/geo";
import type { Editor } from "./Editor";
import { computed, track } from "../signals";
import type { ComputedSignal } from "../signals";

/** A node's cached placement cells; disposed when the node leaves the scene. */
interface PlacementCells {
  readonly frame: ComputedSignal<Mat>;
  extent: ComputedSignal<Bounds | null> | null;
}

/**
 * Caches where each node sits in the scene, one cell per node.
 *
 * @remarks
 * A node's frame-to-scene transform depends on its own record, its parent's
 * transform, and where its parent lays it out, so moving a node reruns its
 * cell and its descendants' and nothing else. A top-level node's extent (its
 * scene box and its descendants') lets drawing and hit testing skip whole
 * subtrees that are off screen or away from the pointer.
 */
export class SceneTransforms {
  readonly #editor: Editor;
  // non-reactive: cache of per-node cells, pruned when nodes are deleted
  readonly #cells = new Map<NodeId, PlacementCells>();
  readonly #stopPruning: () => void;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#stopPruning = editor.scene.pruneDeleted(
      this.#cells,
      (cells) => {
        cells.frame.dispose();
        cells.extent?.dispose();
      },
      "editor.sceneTransforms.prune",
    );
  }

  /**
   * Returns the transform from a node's frame to the scene: Y-down, origin at
   * the node's position, nested in its parent's frame.
   *
   * @remarks
   * Reactive: inside a computed or effect, the reader reruns when this node's
   * placement changes. Treat the matrix as read-only; it is shared.
   */
  frameToScene(nodeId: NodeId): Mat {
    const cell = this.#cellsFor(nodeId).frame;
    track(cell);
    return cell.peek();
  }

  /**
   * Returns the scene box of a node and everything under it.
   *
   * @remarks
   * Reactive, like {@link frameToScene}. Null when nothing under the node
   * reports bounds, so callers must not skip it on that account.
   */
  extent(nodeId: NodeId): Bounds | null {
    const cells = this.#cellsFor(nodeId);
    cells.extent ??= computed(() => this.#extent(nodeId), {
      name: "editor.sceneTransforms.extent",
      equals: Bounds.equals,
    });
    track(cells.extent);
    return cells.extent.peek();
  }

  dispose(): void {
    this.#stopPruning();
    for (const cells of this.#cells.values()) {
      cells.frame.dispose();
      cells.extent?.dispose();
    }
    this.#cells.clear();
  }

  #cellsFor(nodeId: NodeId): PlacementCells {
    let cells = this.#cells.get(nodeId);
    if (cells) return cells;

    cells = {
      frame: computed(() => this.#frame(nodeId), {
        name: "editor.sceneTransforms.frame",
        equals: sameMat,
      }),
      extent: null,
    };
    this.#cells.set(nodeId, cells);
    return cells;
  }

  #frame(nodeId: NodeId): Mat {
    const scene = this.#editor.scene;
    const node = scene.record(nodeId);
    if (!node) return Mat.Identity();

    track(scene.structureCell);
    const parentId = scene.structureCell.peek().parent(nodeId);
    const parent = parentId ? scene.record(parentId) : null;
    if (!parentId || !parent) return Mat.Translate(node.position.x, node.position.y);

    const position =
      this.#editor.nodeDefinition(parent.kind).childPosition(parent, node) ?? node.position;
    return Mat.Compose(this.frameToScene(parentId), Mat.Translate(position.x, position.y));
  }

  #extent(nodeId: NodeId): Bounds | null {
    const editor = this.#editor;
    const scene = editor.scene;
    const node = scene.record(nodeId);
    if (!node) return null;

    let extent: Bounds | null = editor.nodeBounds(node);
    track(scene.structureCell);
    for (const childId of scene.structureCell.peek().children(nodeId)) {
      const child = this.extent(childId);
      if (child) extent = extent ? Bounds.union(extent, child) : child;
    }
    return extent;
  }
}

function sameMat(a: MatModel, b: MatModel): boolean {
  return a.a === b.a && a.b === b.b && a.c === b.c && a.d === b.d && a.e === b.e && a.f === b.f;
}
