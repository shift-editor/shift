import type { NodeId, RunId, SourceId } from "@shift/types";
import type { ShiftNode } from "../../types/node";
import type { RevisedNode, RunSettings, SceneIntent, SceneNode } from "../../types/sceneDocument";
import type { TextRunRecord, TextRunSettings } from "../../types/text";
import type { TextItem } from "../text/layout/types";

/** One document node as the editor reads it, and the run it holds when it is a text run. */
interface ReadNode {
  readonly revised: RevisedNode;
  /** The source the session shows a glyph node in instead of its stored one. */
  readonly shownSource: SourceId | undefined;
  readonly node: ShiftNode;
  readonly run: TextRunRecord | null;
}

/** The document's nodes as the editor reads them. */
export interface ReadScene {
  readonly nodes: readonly ShiftNode[];
  /** Each text run's content, by run id. */
  readonly runs: ReadonlyMap<RunId, TextRunRecord>;
  /** The node that holds each run. */
  readonly runNodes: ReadonlyMap<RunId, NodeId>;
  /** The source each glyph node was placed with, as the document stores it. */
  readonly storedSources: ReadonlyMap<NodeId, SourceId>;
}

/**
 * Translates between the document's scene nodes (shift-engine's
 * `SceneNode`) and the editor's {@link ShiftNode}s and run records.
 *
 * @remarks
 * Each read keeps the editor's object for a node while the engine's revision
 * for it is the same, and a run's record while its items revision is, so
 * readers that compare by identity (a run's layout, the pages list) rerun only
 * for what changed. The engine says what changed; nothing here compares nodes.
 */
export class SceneNodes {
  // non-reactive: the previous read's objects, read and replaced only by `read` inside the scene's computed
  #previous: ReadonlyMap<NodeId, ReadNode> = new Map();

  /**
   * The editor's nodes and runs for `revised`, in its order, keeping
   * unchanged ones; a glyph node in `shownSources` shows that source.
   */
  read(revised: readonly RevisedNode[], shownSources: ReadonlyMap<NodeId, SourceId>): ReadScene {
    const next = new Map<NodeId, ReadNode>();
    const nodes: ShiftNode[] = [];
    const runs = new Map<RunId, TextRunRecord>();
    const runNodes = new Map<RunId, NodeId>();
    const storedSources = new Map<NodeId, SourceId>();
    for (const entry of revised) {
      const id = entry.node.id;
      const previous = this.#previous.get(id);
      const shownSource = shownSources.get(id);
      const unchanged =
        previous?.revised.revision === entry.revision && previous.shownSource === shownSource;
      const read = unchanged ? previous : readNode(entry, previous, shownSource);
      next.set(id, read);
      nodes.push(read.node);
      if (read.run) {
        runs.set(read.run.id, read.run);
        runNodes.set(read.run.id, id);
      }
      const content = entry.node.content;
      if (content.kind === "glyph") storedSources.set(id, content.sourceId);
    }
    this.#previous = next;
    return { nodes, runs, runNodes, storedSources };
  }

  /**
   * The intent that places `node`: a text run with `items`, its settings
   * left to the engine's defaults; any other node as the document stores it.
   *
   * @throws When `node`'s kind is not one the document stores.
   */
  static createIntent(node: ShiftNode, items: readonly TextItem[] = []): SceneIntent {
    if (node.kind !== "textRun") {
      return { kind: "createNode", createNode: SceneNodes.toDocument(node, null) };
    }
    return {
      kind: "createRun",
      createRun: {
        id: node.id,
        parentId: node.parentId,
        index: node.index,
        x: node.position.x,
        y: node.position.y,
        runId: node.runId,
        size: node.size,
        items: [...items],
      },
    };
  }

  /**
   * `node` as the document stores it. A text run's items and settings are
   * the ones `run` holds now; an update keeps the run's own regardless, and
   * only `setRunItems` and `setRunSettings` change them.
   *
   * @throws When `node`'s kind is not one the document stores, or a text
   * run comes without its run.
   */
  static toDocument(node: ShiftNode, run: TextRunRecord | null): SceneNode {
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
        if (!run) throw new Error(`text run node ${node.id} has no run`);
        return {
          ...base,
          content: {
            kind: "textRun",
            runId: node.runId,
            size: node.size,
            items: [...run.items],
            settings: runSettingsOf(run),
          },
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

/** A run record's settings as the scene stores them: a forced feature on is `1`, off `0`. */
export function runSettingsOf(run: TextRunSettings): RunSettings {
  return {
    shaping: run.shaping,
    features: Object.entries(run.features).map(([tag, on]) => ({ tag, value: on ? 1 : 0 })),
    language: run.language,
    script: run.script,
    lineHeight: run.lineHeight,
    align: run.align,
  };
}

/** The run record's settings for what the scene stores. */
function runSettingsFrom(settings: RunSettings): TextRunSettings {
  return {
    shaping: settings.shaping,
    features: Object.fromEntries(settings.features.map(({ tag, value }) => [tag, value > 0])),
    language: settings.language ?? null,
    script: settings.script ?? null,
    lineHeight: settings.lineHeight ?? null,
    align: settings.align ?? null,
  };
}

/** The editor's node for `revised`, keeping the previous run record while its items are unchanged. */
function readNode(
  revised: RevisedNode,
  previous: ReadNode | undefined,
  shownSource: SourceId | undefined,
): ReadNode {
  const stored = revised.node;
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
        revised,
        shownSource,
        node: { ...base, kind: "page", name: content.name, role: content.role ?? undefined },
        run: null,
      };
    case "textRun": {
      const kept = previous?.revised.itemsRevision === revised.itemsRevision ? previous.run : null;
      const run: TextRunRecord = kept ?? {
        id: content.runId,
        type: "textrun",
        scope: "document",
        items: content.items,
        ...runSettingsFrom(content.settings),
      };
      return {
        revised,
        shownSource,
        node: { ...base, kind: "textRun", runId: content.runId, size: content.size },
        run,
      };
    }
    case "glyph":
      return {
        revised,
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
