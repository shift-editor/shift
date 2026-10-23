import type { Point2D } from "@shift/geo";
import type { GlyphId, NodeId, RunId, SourceId, TextItemId } from "@shift/types";
import type { FrameLayout, Sizing } from "./frame";

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

  /**
   * Run item this glyph occupies when its parent is a text run.
   *
   * @remarks
   * The run places the node at the item's layout position and stops drawing
   * the item itself. Absent for glyph nodes placed directly in the scene.
   */
  readonly itemId?: TextItemId;
}

/**
 * Which glyph a glyph node shows, without the rest of its record.
 *
 * @remarks
 * For readers that follow "the glyph on the page" and must not rerun when that
 * node, or any other node, moves.
 */
export interface SceneGlyph {
  /** The glyph node. */
  readonly nodeId: NodeId;

  /** The glyph it shows. */
  readonly glyphId: GlyphId;
}

/**
 * Places a text run in the editor scene: a text box.
 *
 * @remarks
 * A text run node is the movable proofing container for text-domain layout. It
 * points at document-scoped run content and carries placement and size. Its
 * `position` is the top-left corner of its box; the first baseline sits the
 * ascender below it. Its size follows {@link TextRunNode.width} and
 * {@link TextRunNode.height}: hugging both is auto width, a fixed width with
 * a hugging height is auto height, and fixing both is a fixed size, whose
 * text can run past the box's bottom.
 */
export interface TextRunNode extends Node {
  readonly kind: "textRun";

  /** Document-scoped text content placed by this node. */
  readonly runId: RunId;

  /** Proof rendering size for this placement: scene units per em. */
  readonly size: number;

  /**
   * The box's width: `hug` keeps each paragraph on one line, `fixed` wraps
   * lines at `size` scene units, and `fill` takes the room left in the parent
   * frame and wraps there (outside a frame it lays out as `hug`).
   */
  readonly width: Sizing;

  /**
   * The box's height: `hug` fits its lines, `fixed` keeps `size` scene units
   * whatever the text needs. (`fill` lays out as `hug`.)
   */
  readonly height: Sizing;

  /**
   * How far the box turns about its top-left corner, in radians; positive
   * turns clockwise on the Y-down canvas. Its text wraps along the box.
   */
  readonly rotation: number;
}

/**
 * A top-level canvas.
 *
 * @remarks
 * Every other node descends from exactly one page. A page has no parent, sits
 * at the scene origin, and draws nothing itself; the canvas shows one page at
 * a time (`Scene.activePageIdCell`). Pages are ordered among themselves by
 * `index`, which is their order in the pages list.
 */
export interface PageNode extends Node {
  readonly kind: "page";

  /** Shown in the pages list. */
  readonly name: string;
}

/**
 * An auto layout frame: stacks its children in a row or column.
 *
 * @remarks
 * A frame sits on a page or inside another frame, and holds text runs and
 * frames. The page layout (`Frames.laidOut`) sizes it and places its
 * children, so a child's own `position` is ignored; a frame on a page keeps
 * its `position`. Frames neither clip nor scale their content.
 */
export interface FrameNode extends Node {
  readonly kind: "frame";

  /** Shown in the inspector. */
  readonly name: string;

  readonly layout: FrameLayout;
  readonly width: Sizing;
  readonly height: Sizing;
}

/**
 * Maps each scene node kind to its node type.
 *
 * @remarks
 * An open registry: `ShiftNode`, `NodeKind` and the scene's kind queries are
 * derived from it, so a package that adds a node kind extends this interface
 * through declaration merging instead of editing a union:
 *
 * ```ts
 * declare module "@shift/editor/types" {
 *   interface SceneNodeKinds {
 *     "acme.guide": GuideNode;
 *   }
 * }
 * ```
 *
 * Code outside `lib/nodes/` asks a node's definition what the node offers
 * (for example {@link NodeDefinition.textItems}) rather than switching on
 * built-in kinds, so a new kind works with the existing commands.
 */
export interface SceneNodeKinds {
  glyph: GlyphNode;
  textRun: TextRunNode;
  page: PageNode;
  frame: FrameNode;
}

/** Identifies a registered scene node kind. */
export type NodeKind = keyof SceneNodeKinds;

/** The node type registered for one kind. */
export type NodeOfKind<K extends NodeKind> = SceneNodeKinds[K];

/** Represents every scene node kind registered in {@link SceneNodeKinds}. */
export type ShiftNode = SceneNodeKinds[NodeKind];

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
