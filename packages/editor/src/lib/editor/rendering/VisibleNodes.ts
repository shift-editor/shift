import { Bounds } from "@shift/geo";
import type { NodeId } from "@shift/types";
import { computed, effect, track } from "../../signals";
import type { ComputedSignal, Effect, Signal } from "../../signals";
import type { SpaceTransform } from "../../../types/coordinates";
import type { ShiftNode } from "../../../types/node";
import type { Editor } from "../Editor";

/** A node to draw and the transform from its own units to the scene. */
export interface VisibleNode {
  readonly node: ShiftNode;
  readonly transform: SpaceTransform<"local", "scene">;
}

/**
 * The active page's nodes that reach the screen, for the render layers.
 *
 * @remarks
 * Kept per top-level node: each one's subtree (records, transforms, and text
 * layouts) is a cell of its own, so editing one subtree rebuilds that list
 * only, and panning or zooming only checks each top-level node's extent
 * against the view. A top-level node holding an edited node is always kept,
 * since handles and anchors can reach past its bounds.
 */
export class VisibleNodes {
  readonly #editor: Editor;
  // non-reactive: cache of per-subtree cells, pruned by #pruner when nodes leave the scene
  readonly #subtrees = new Map<NodeId, ComputedSignal<readonly VisibleNode[]>>();
  readonly #cell: ComputedSignal<readonly VisibleNode[]>;
  readonly #pruner: Effect;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#cell = computed(() => this.#visible(), { name: "renderer.visibleNodes" });
    this.#pruner = effect(
      () => {
        const structure = editor.scene.structureCell.value;
        for (const [id, subtree] of this.#subtrees) {
          if (structure.get(id) !== null) continue;
          subtree.dispose();
          this.#subtrees.delete(id);
        }
      },
      { name: "renderer.visibleNodes.prune" },
    );
  }

  /** Visible nodes, parents before children; readers rerun when any of them or the view changes. */
  get cell(): Signal<readonly VisibleNode[]> {
    return this.#cell;
  }

  dispose(): void {
    this.#pruner.dispose();
    this.#cell.dispose();
    for (const subtree of this.#subtrees.values()) subtree.dispose();
    this.#subtrees.clear();
  }

  #visible(): readonly VisibleNode[] {
    const editor = this.#editor;
    const scene = editor.scene;
    track(scene.activePageIdCell);
    track(scene.structureCell);
    track(editor.editing.stateCell);
    const pageId = scene.activePageIdCell.peek();
    if (!pageId) return [];

    editor.camera.trackViewportTransform();
    const camera = editor.camera;
    const visible =
      camera.logicalWidth > 0 && camera.logicalHeight > 0 ? camera.visibleSceneBounds(0) : null;
    const view = visible
      ? Bounds.create({ x: visible.minX, y: visible.minY }, { x: visible.maxX, y: visible.maxY })
      : null;
    const editedRoots = new Set(
      editor.editing.stateCell.peek().nodeIds.map((id) => scene.topLevelOf(id)),
    );

    const nodes: VisibleNode[] = [];
    for (const rootId of scene.structureCell.peek().children(pageId)) {
      const extent = editor.nodeExtent(rootId);
      if (view && extent && !editedRoots.has(rootId) && !Bounds.overlaps(extent, view)) continue;

      const subtree = this.#subtree(rootId);
      track(subtree);
      for (const entry of subtree.peek()) nodes.push(entry);
    }
    return nodes;
  }

  #subtree(rootId: NodeId): ComputedSignal<readonly VisibleNode[]> {
    let subtree = this.#subtrees.get(rootId);
    if (subtree) return subtree;

    subtree = computed(
      () => {
        const editor = this.#editor;
        const scene = editor.scene;
        const entries: VisibleNode[] = [];
        for (const id of [rootId, ...scene.structureCell.value.descendants(rootId)]) {
          const node = scene.record(id);
          if (!node) continue;
          if (node.kind === "textRun") track(editor.text.layoutCell(node.runId));
          entries.push({ node, transform: editor.sceneTransform(node) });
        }
        return entries;
      },
      { name: "renderer.visibleNodes.subtree" },
    );
    this.#subtrees.set(rootId, subtree);
    return subtree;
  }
}
