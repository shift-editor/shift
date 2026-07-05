import type { Point2D } from "@shift/geo";
import type { GlyphId, NodeId, SourceId } from "@shift/types";

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

/** Represents every scene node kind known to this build. */
export type ShiftNode = GlyphNode;

/** Identifies a registered scene node behavior kind. */
export type NodeKind = ShiftNode["kind"];
