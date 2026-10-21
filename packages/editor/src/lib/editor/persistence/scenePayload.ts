import type { Point2D } from "@shift/geo";
import {
  isGlyphId,
  isNodeId,
  isRunId,
  isSourceId,
  isTextItemId,
  type GlyphId,
  type NodeId,
  type RunId,
  type SourceId,
} from "@shift/types";
import type { NodeKind } from "../../../types/node";
import type { GlyphNodeRecord, ShiftNodeRecord, TextRunNodeRecord } from "../../../types/records";
import type {
  DroppedSceneRecord,
  PersistedSceneRecord,
  SceneReferences,
  SceneRestore,
  StoredSceneState,
} from "../../../types/sceneState";
import type { TextRunRecord } from "../../../types/text";
import type { TextItem } from "../../text/layout/types";

/** Format version of the payloads this editor writes and reads. */
export const SCENE_PAYLOAD_VERSION = 1;

const MAX_CODEPOINT = 0x10ffff;

type Fields = Readonly<Record<string, unknown>>;

/**
 * Serializes canvas records into a stored scene state.
 *
 * @param records - Document-scoped records, parents before children.
 */
export function encodeSceneState(records: readonly PersistedSceneRecord[]): StoredSceneState {
  return { version: SCENE_PAYLOAD_VERSION, payload: JSON.stringify({ records }) };
}

/**
 * Reads a stored canvas back into records that are safe to put in the editor.
 *
 * @remarks
 * Malformed records are dropped, then nodes whose references no longer
 * resolve: a node whose parent is gone (or was dropped), a run node whose
 * run is gone, a glyph node whose glyph or source is gone, and a child glyph
 * whose run item is gone. A run node keeps at most one child glyph. Every
 * registered node kind is read (see {@link NODE_PARSERS}); a node of a kind
 * this editor does not register is dropped. Nodes come back parents first,
 * after the runs. A payload of an unknown version or that is not JSON
 * restores nothing.
 *
 * @param stored - The scene state a {@link SceneStateStore} returned.
 * @param references - Lookups into the open font.
 */
export function decodeSceneState(
  stored: StoredSceneState,
  references: SceneReferences,
): SceneRestore {
  if (stored.version !== SCENE_PAYLOAD_VERSION) {
    return unreadable(`unsupported scene payload version ${stored.version}`);
  }

  const parsed = parseJson(stored.payload);
  if (!isFields(parsed) || !Array.isArray(parsed.records)) {
    return unreadable("scene payload is not a record list");
  }

  const dropped: DroppedSceneRecord[] = [];
  const runs = new Map<RunId, TextRunRecord>();
  const nodes = new Map<NodeId, ShiftNodeRecord>();
  for (const value of parsed.records) {
    const record = parseRecord(value);
    if (!record) {
      dropped.push({ id: recordId(value), reason: "malformed record" });
      continue;
    }

    if (record.type === "textrun") runs.set(record.id, record);
    else nodes.set(record.id, record);
  }

  const resolver = new NodeResolver(references, runs, nodes);
  for (const node of nodes.values()) resolver.resolve(node);

  return {
    restored: [...runs.values(), ...resolver.restored],
    dropped: [...dropped, ...resolver.dropped],
  };
}

/**
 * Checks stored nodes parents first, so a node is restored only after its
 * parent is, and a dropped parent drops its subtree.
 */
class NodeResolver {
  readonly restored: ShiftNodeRecord[] = [];
  readonly dropped: DroppedSceneRecord[] = [];
  readonly #references: SceneReferences;
  readonly #runs: ReadonlyMap<RunId, TextRunRecord>;
  readonly #nodes: ReadonlyMap<NodeId, ShiftNodeRecord>;
  readonly #outcomes = new Map<NodeId, boolean>();
  readonly #visiting = new Set<NodeId>();
  readonly #runsWithChild = new Set<NodeId>();

  constructor(
    references: SceneReferences,
    runs: ReadonlyMap<RunId, TextRunRecord>,
    nodes: ReadonlyMap<NodeId, ShiftNodeRecord>,
  ) {
    this.#references = references;
    this.#runs = runs;
    this.#nodes = nodes;
  }

  /** Returns whether `node` is restored, deciding its ancestors first. */
  resolve(node: ShiftNodeRecord): boolean {
    const known = this.#outcomes.get(node.id);
    if (known !== undefined) return known;

    const reason = this.#problem(node);
    const restored = reason === null;
    this.#outcomes.set(node.id, restored);
    if (reason) this.dropped.push({ id: node.id, reason });
    else this.restored.push(node);
    return restored;
  }

  #problem(node: ShiftNodeRecord): string | null {
    const parentProblem = this.#parentProblem(node);
    if (parentProblem) return parentProblem;

    switch (node.kind) {
      case "textRun":
        return this.#runs.has(node.runId) ? null : `missing run ${node.runId}`;
      case "glyph":
        return this.#glyphProblem(node);
    }
  }

  #parentProblem(node: ShiftNodeRecord): string | null {
    if (node.parentId === null) return null;

    const parent = this.#nodes.get(node.parentId);
    if (!parent || this.#visiting.has(node.id)) return `missing parent ${node.parentId}`;

    this.#visiting.add(node.id);
    const parentRestored = this.resolve(parent);
    this.#visiting.delete(node.id);
    return parentRestored ? null : `missing parent ${node.parentId}`;
  }

  #glyphProblem(node: GlyphNodeRecord): string | null {
    if (!this.#references.hasGlyph(node.glyphId)) return `missing glyph ${node.glyphId}`;
    if (!this.#references.hasSource(node.sourceId)) return `missing source ${node.sourceId}`;
    if (node.itemId === undefined) return null;

    const parent = node.parentId ? this.#nodes.get(node.parentId) : null;
    if (parent?.kind !== "textRun") return "run item outside a run node";
    if (this.#runsWithChild.has(parent.id)) return `run node ${parent.id} already has a child`;

    const items = this.#runs.get(parent.runId)?.items ?? [];
    const item = items.find((candidate) => candidate.id === node.itemId);
    if (!item || item.kind === "linebreak") return `missing run item ${node.itemId}`;

    this.#runsWithChild.add(parent.id);
    return null;
  }
}

function unreadable(reason: string): SceneRestore {
  return { restored: [], dropped: [{ id: "payload", reason }] };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function recordId(value: unknown): string {
  if (isFields(value) && typeof value.id === "string") return value.id;

  return "unknown";
}

function isFields(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseRecord(value: unknown): PersistedSceneRecord | null {
  if (!isFields(value)) return null;

  switch (value.type) {
    case "textrun":
      return parseRun(value);
    case "node":
      return parseNode(value);
    default:
      return null;
  }
}

function parseRun(fields: Fields): TextRunRecord | null {
  if (!isRunId(fields.id) || !Array.isArray(fields.items)) return null;

  const items: TextItem[] = [];
  for (const value of fields.items) {
    const item = parseTextItem(value);
    if (!item) return null;
    items.push(item);
  }

  return { id: fields.id, type: "textrun", scope: "document", items };
}

function parseTextItem(value: unknown): TextItem | null {
  if (!isFields(value) || !isTextItemId(value.id)) return null;

  switch (value.kind) {
    case "character":
      return isCodepoint(value.codepoint)
        ? { id: value.id, kind: "character", codepoint: value.codepoint }
        : null;
    case "glyph":
      return isGlyphId(value.glyphId)
        ? { id: value.id, kind: "glyph", glyphId: value.glyphId }
        : null;
    case "linebreak":
      return { id: value.id, kind: "linebreak" };
    default:
      return null;
  }
}

function isCodepoint(value: unknown): value is number {
  return (
    Number.isInteger(value) && typeof value === "number" && value >= 0 && value <= MAX_CODEPOINT
  );
}

/** The fields every node record shares. */
interface NodeBase {
  readonly id: NodeId;
  readonly type: "node";
  readonly parentId: NodeId | null;
  readonly index: string;
  readonly position: Point2D;
}

/** Reads one stored node of a kind; null when its fields are malformed. */
type NodeParser = (base: NodeBase, fields: Fields) => ShiftNodeRecord | null;

/**
 * One parser per registered node kind.
 *
 * @remarks
 * Keyed by every {@link NodeKind}, so registering a kind in `SceneNodeKinds`
 * (pages, for example) fails to compile until it says how its stored records
 * are read; no kind is silently left out of a reopened canvas.
 */
const NODE_PARSERS: { readonly [K in NodeKind]: NodeParser } = {
  textRun: parseRunNode,
  glyph: parseGlyphNode,
};

function isNodeKind(kind: unknown): kind is NodeKind {
  return typeof kind === "string" && Object.hasOwn(NODE_PARSERS, kind);
}

function parseNode(fields: Fields): ShiftNodeRecord | null {
  const base = parseNodeBase(fields);
  if (!base || !isNodeKind(fields.kind)) return null;

  return NODE_PARSERS[fields.kind](base, fields);
}

function parseNodeBase(fields: Fields): NodeBase | null {
  if (!isNodeId(fields.id) || typeof fields.index !== "string") return null;

  const parentId = fields.parentId;
  if (parentId !== null && !isNodeId(parentId)) return null;

  const position = parsePoint(fields.position);
  if (!position) return null;

  return { id: fields.id, type: "node", parentId, index: fields.index, position };
}

function parsePoint(value: unknown): Point2D | null {
  if (!isFields(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return null;

  return { x: value.x, y: value.y };
}

function parseRunNode(base: NodeBase, fields: Fields): TextRunNodeRecord | null {
  const size = fields.size;
  if (!isRunId(fields.runId) || !isFiniteNumber(size) || size <= 0) return null;

  return { ...base, kind: "textRun", runId: fields.runId, size };
}

function parseGlyphNode(base: NodeBase, fields: Fields): GlyphNodeRecord | null {
  const glyphId: GlyphId | null = isGlyphId(fields.glyphId) ? fields.glyphId : null;
  const sourceId: SourceId | null = isSourceId(fields.sourceId) ? fields.sourceId : null;
  if (!glyphId || !sourceId) return null;

  const itemId = fields.itemId;
  if (itemId === undefined) return { ...base, kind: "glyph", glyphId, sourceId };
  if (!isTextItemId(itemId)) return null;

  return { ...base, kind: "glyph", glyphId, sourceId, itemId };
}
