import type { NodeId, RunId, SourceId } from "@shift/types";
import type { ShiftNode } from "../../types/node";
import type { SceneNode } from "../../types/sceneDocument";
import type { TextRunRecord } from "../../types/text";
import type { TextItem } from "../text/layout/types";

/** One document node as the editor reads it, and the run it holds when it is a text run. */
interface ReadNode {
  readonly stored: SceneNode;
  /** The source the session shows a glyph node in instead of its stored one. */
  readonly shownSource: SourceId | undefined;
  readonly node: ShiftNode;
  readonly run: TextRunRecord | null;
}

/** The document's nodes as the editor reads them. */
export interface ReadScene {
  readonly nodes: readonly ShiftNode[];
  readonly runs: ReadonlyMap<RunId, TextRunRecord>;
}

/**
 * Translates between the document's scene nodes (shift-engine's
 * `SceneNode`) and the editor's {@link ShiftNode}s and run records.
 *
 * @remarks
 * Each read keeps the editor's object for a node, and for its run, when the
 * document's node is unchanged, so readers that compare by identity (a run's
 * layout, the pages list) rerun only for what changed.
 */
export class SceneNodes {
  // non-reactive: the previous read's objects, read and replaced only by `read` inside the scene's computed
  #previous: ReadonlyMap<NodeId, ReadNode> = new Map();

  /**
   * The editor's nodes and runs for `stored`, in its order, reusing unchanged
   * ones; a glyph node in `shownSources` shows that source.
   */
  read(stored: readonly SceneNode[], shownSources: ReadonlyMap<NodeId, SourceId>): ReadScene {
    const next = new Map<NodeId, ReadNode>();
    const nodes: ShiftNode[] = [];
    const runs = new Map<RunId, TextRunRecord>();
    for (const node of stored) {
      const previous = this.#previous.get(node.id);
      const shownSource = shownSources.get(node.id);
      const unchanged =
        previous && previous.shownSource === shownSource && sameStoredNode(previous.stored, node);
      const read = unchanged ? previous : readNode(node, previous, shownSource);
      next.set(node.id, read);
      nodes.push(read.node);
      if (read.run) runs.set(read.run.id, read.run);
    }
    this.#previous = next;
    return { nodes, runs };
  }

  /**
   * `node` as the document stores it; a text run carries `items`.
   *
   * @throws When `node`'s kind is not one the document stores.
   */
  static toDocument(node: ShiftNode, items: readonly TextItem[]): SceneNode {
    const base = {
      id: node.id,
      parentId: node.parentId,
      index: node.index,
      x: node.position.x,
      y: node.position.y,
    };
    switch (node.kind) {
      case "page":
        return { ...base, content: { kind: "page", name: node.name, role: node.role ?? null } };
      case "textRun":
        return {
          ...base,
          content: { kind: "textRun", runId: node.runId, size: node.size, items: [...items] },
        };
      case "glyph":
        return {
          ...base,
          content: {
            kind: "glyph",
            glyphId: node.glyphId,
            sourceId: node.sourceId,
            itemId: node.itemId ?? null,
          },
        };
      default:
        throw new Error(`scene nodes of kind ${(node as ShiftNode).kind} are not stored`);
    }
  }
}

/** The editor's node for `stored`, keeping the previous run record when its items are unchanged. */
function readNode(
  stored: SceneNode,
  previous: ReadNode | undefined,
  shownSource: SourceId | undefined,
): ReadNode {
  const base = {
    id: stored.id,
    type: "node" as const,
    parentId: stored.parentId ?? null,
    index: stored.index,
    position: { x: stored.x, y: stored.y },
  };
  const content = stored.content;
  switch (content.kind) {
    case "page":
      return {
        stored,
        shownSource,
        node: { ...base, kind: "page", name: content.name, role: content.role ?? undefined },
        run: null,
      };
    case "textRun": {
      const kept = previous?.run;
      const run: TextRunRecord =
        kept?.id === content.runId && sameItems(kept.items, content.items)
          ? kept
          : { id: content.runId, type: "textrun", scope: "document", items: content.items };
      return {
        stored,
        shownSource,
        node: { ...base, kind: "textRun", runId: content.runId, size: content.size },
        run,
      };
    }
    case "glyph":
      return {
        stored,
        shownSource,
        node: {
          ...base,
          kind: "glyph",
          glyphId: content.glyphId,
          sourceId: shownSource ?? content.sourceId,
          itemId: content.itemId ?? undefined,
        },
        run: null,
      };
  }
}

/** Whether two stored nodes are the same in every field. */
function sameStoredNode(a: SceneNode, b: SceneNode): boolean {
  if (a.parentId !== b.parentId || a.index !== b.index || a.x !== b.x || a.y !== b.y) return false;

  const left = a.content;
  const right = b.content;
  switch (left.kind) {
    case "page":
      return right.kind === "page" && left.name === right.name && left.role === right.role;
    case "textRun":
      return (
        right.kind === "textRun" &&
        left.runId === right.runId &&
        left.size === right.size &&
        sameItems(left.items, right.items)
      );
    case "glyph":
      return (
        right.kind === "glyph" &&
        left.glyphId === right.glyphId &&
        left.sourceId === right.sourceId &&
        left.itemId === right.itemId
      );
  }
}

/** Whether two item lists hold the same items in the same order. */
function sameItems(a: readonly TextItem[], b: readonly TextItem[]): boolean {
  return a.length === b.length && a.every((item, index) => sameItem(item, b[index]!));
}

function sameItem(a: TextItem, b: TextItem): boolean {
  if (a.id !== b.id) return false;

  switch (a.kind) {
    case "character":
      return b.kind === "character" && a.codepoint === b.codepoint;
    case "glyph":
      return b.kind === "glyph" && a.glyphId === b.glyphId;
    case "linebreak":
      return b.kind === "linebreak";
  }
}
