import type { Point2D } from "@shift/geo";
import type { GlyphId, Location, NodeId, RunId, SourceId } from "@shift/types";

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

  /** Scene-space position of this placed occurrence. */
  position: Point2D;
}

/**
 * Places an authored glyph source in the editor scene.
 *
 * @remarks
 * A glyph node is the scene occurrence for editable glyph geometry. It points
 * at canonical font data by `glyphId` and `sourceId`; it does not own glyph
 * outlines, layer geometry, or display state.
 */
export interface GlyphNode extends Node {
  readonly kind: "glyph";

  /** Glyph identity whose authored layer is shown by this scene node. */
  readonly glyphId: GlyphId;

  /** Source identity selecting the authored layer shown by this scene node. */
  readonly sourceId: SourceId;
}

/**
 * Places a text run in the editor scene.
 *
 * @remarks
 * A text run node is the movable proofing container for text-domain layout. It
 * points at document-scoped run content and carries placement styling such as
 * size and design location.
 */
export interface TextRunNode extends Node {
  readonly kind: "textRun";

  /** Document-scoped text content placed by this node. */
  readonly runId: RunId;

  /** Proof rendering size for this placement. */
  readonly size: number;

  /** Pinned variation location used when shaping and drawing this placement. */
  readonly designLocation: Location;
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
