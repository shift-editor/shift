import type { Point2D } from "@shift/geo";
import type { NodeId, RunId, SourceId, TextItemId } from "@shift/types";

/**
 * Describes a placed object in the editor scene.
 *
 * @remarks
 * Nodes own scene identity and placement only. Canonical glyph data, image
 * assets, text layout, and editing behavior live in the subsystem referenced by
 * the node kind.
 */
export interface Node {
  /** Stable scene identity for this placed occurrence. */
  id: NodeId;

  /** Record category for scene graph nodes. */
  type: "node";

  /** Node kind used to resolve behavior and backing model data. */
  kind: string;

  /** Parent scene node, or null when this node is at the scene root. */
  parentId: NodeId | null;

  /** Sort key among siblings under the same parent. */
  index: string;

  /**
   * Origin of this node's frame within its parent's frame, or within the scene
   * for a root node; Y-down, in scene units.
   */
  position: Point2D;
}

/**
 * Edits one glyph of a text run in place: a slot in the text, not a glyph.
 *
 * @remarks
 * A glyph node is always a child of a text run. It names an item of the run
 * and which of the glyphs that item shapes to, and the glyph it shows is
 * resolved from the run's layout each time ({@link Editor.glyphIdOf}), so it
 * follows shaping: turning `frac` on makes the node over `1` show
 * `one.numr`. It does not own glyph outlines, layer geometry, or display state.
 */
export interface GlyphNode extends Node {
  readonly kind: "glyph";

  /** Source identity selecting the authored layer shown by this scene node. */
  readonly sourceId: SourceId;

  /** The run item this node edits. */
  readonly itemId: TextItemId;

  /**
   * Which of the glyphs the item shapes to, in logical order: 0 for the
   * first, such as a letter's body, 1 for the next, such as its dot.
   *
   * @remarks
   * Past the item's last glyph, the node shows its first.
   */
  readonly part: number;
}

/**
 * Places a text run in the editor scene.
 *
 * @remarks
 * A text run node is the movable proofing container for text-domain layout. It
 * points at document-scoped run content and carries placement and size.
 */
export interface TextRunNode extends Node {
  readonly kind: "textRun";

  /** Document-scoped text content placed by this node. */
  readonly runId: RunId;

  /** Proof rendering size for this placement. */
  readonly size: number;
}

/** Represents every scene node kind known to this build. */
export type ShiftNode = GlyphNode | TextRunNode;

/** Identifies a registered scene node behavior kind. */
export type NodeKind = ShiftNode["kind"];

/**
 * Describes a scene node before the scene completes record identity.
 *
 * @remarks
 * Callers provide the kind-specific fields and placement. `Scene.createNode`
 * supplies the node record tag plus default identity, parent, and ordering
 * fields when they are omitted.
 */
export type CreateNode<N extends ShiftNode = ShiftNode> = N extends ShiftNode
  ? Omit<N, "id" | "type" | "parentId" | "index"> & Partial<Pick<N, "id" | "parentId" | "index">>
  : never;

/**
 * Describes mutable node fields for patch-style scene updates.
 *
 * @remarks
 * Node identity, record type, and kind are stable for the lifetime of a node.
 * Changing kind should be modeled as deleting one node and creating another.
 */
export type UpdateNode<N extends ShiftNode = ShiftNode> = N extends ShiftNode
  ? Pick<N, "id"> & Partial<Omit<N, "id" | "type" | "kind">>
  : never;
