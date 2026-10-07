import type { Mat, Point2D } from "@shift/geo";
import type { Editor } from "../editor/Editor";
import type { LocalBounds, LocalPoint } from "../../types/coordinates";
import type { ShiftNode } from "../../types/node";
import type { NodeReference } from "../../types/records";
import type { PointerTarget } from "../../types/target";
import type { RenderContext, RenderPass } from "../../types/rendering";

/**
 * Defines behavior shared by every scene node of one kind.
 *
 * @remarks
 * A definition is created once per editor and registered by `kind`. It owns
 * kind-level behavior such as hit testing, bounds, and drawing; selected IDs
 * still resolve through `ShiftObject` references.
 *
 * Two kinds of method, kept apart:
 * - Queries (`unitsTransform`, `bounds`, `hit`, `childPosition`, `draw`) run
 *   during rendering and hit testing and must never write.
 * - Hooks (`onDoubleClick`, `onContentChange`) may write. The editor calls
 *   them inside a history capture, so their writes are one undo step with the
 *   action that triggered them.
 */
export abstract class NodeDefinition<N extends ShiftNode = ShiftNode> {
  /**
   * Creates behavior bound to one editor runtime.
   *
   * @param editor - editor session that provides font, scene, selection, hover, and camera context.
   */
  constructor(protected readonly editor: Editor) {}

  /** Identifies the node kind this definition handles. */
  abstract readonly kind: N["kind"];

  /**
   * Returns the step from this kind's drawing units to a Y-down frame at the node's origin.
   *
   * @remarks
   * Kinds drawn in Y-up font units flip here; kinds already Y-down return the
   * identity. The node's position is applied separately.
   *
   * @param node - scene node handled by this definition.
   */
  abstract unitsTransform(node: N): Mat;

  /**
   * Returns a node's bounds in its own units.
   *
   * @remarks
   * Convert to scene space through the node, with `Editor.nodeBounds`.
   *
   * @param node - scene node handled by this definition.
   * @returns null when this node has no bounds for selection or hit expansion.
   */
  abstract bounds(node: N): LocalBounds | null;

  /**
   * Hit-tests a node-local pointer position.
   *
   * @param node - scene node handled by this definition.
   * @param point - pointer position already converted into the node's local coordinate space.
   * @returns the top target for this node, or null when the node was not hit.
   */
  abstract hit(node: N, point: LocalPoint): PointerTarget | null;

  /**
   * Returns where this node lays out one of its children.
   *
   * @remarks
   * Kinds that lay out their children (text runs) override this. The result
   * replaces the child's authored `position` as its frame origin.
   *
   * @param _parent - scene node handled by this definition.
   * @param _child - a node whose `parentId` is `_parent`.
   * @returns the child's frame origin in the parent's frame, or null to use the child's own position.
   */
  childPosition(_parent: N, _child: ShiftNode): Point2D | null {
    return null;
  }

  /**
   * Names the records and glyphs this node depends on.
   *
   * @remarks
   * The scene files each node under its references, so
   * `scene.nodesReferencing(id)` finds every node that depends on `id`. When a
   * referenced record changes in a capture, the editor calls
   * {@link onContentChange} for the node. Must be a pure function of the node's
   * record: the scene recomputes it only when the node record changes.
   *
   * @returns the referenced ids; empty when the node depends on nothing outside itself.
   */
  references?(node: N): readonly NodeReference[];

  /**
   * Responds to a double-click on this node or on one of its descendants.
   *
   * @remarks
   * The editor asks the hit node first, then each ancestor, until one returns
   * true. Runs inside a capture.
   *
   * @param node - the node asked; the hit node or one of its ancestors.
   * @param target - what the pointer hit.
   * @returns true when handled.
   */
  onDoubleClick?(node: N, target: PointerTarget): boolean;

  /**
   * Brings the node's children and fields back in step after its content changed.
   *
   * @remarks
   * Called as a capture finishes, for each node whose record or content record
   * changed in it, whoever made the change. A text run deletes the child whose
   * item was removed. Changes made here can trigger further calls until
   * nothing else changes.
   */
  onContentChange?(node: N): void;

  /**
   * Paints a node for one render pass.
   *
   * @param _node - scene node handled by this definition.
   * @param _ctx - renderer-owned resources for the current frame.
   * @param _pass - phase requested by the render layer.
   */
  draw(_node: N, _ctx: RenderContext, _pass: RenderPass): void {}
}

/** Constructs a node definition bound to one editor runtime. */
export interface NodeDefinitionConstructor<Definition extends NodeDefinition = NodeDefinition> {
  new (editor: Editor): Definition;
}
