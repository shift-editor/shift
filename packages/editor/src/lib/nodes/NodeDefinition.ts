import type { Mat, Point2D } from "@shift/geo";
import type { Editor } from "../editor/Editor";
import type { LocalBounds, LocalPoint } from "../../types/coordinates";
import type { ShiftNode } from "../../types/node";
import type { PointerTarget } from "../../types/target";
import type { RenderContext, RenderPass } from "../../types/rendering";

/**
 * Defines behavior shared by every scene node of one kind.
 *
 * @remarks
 * A definition is created once per editor and registered by `kind`. It owns
 * kind-level behavior such as hit testing, bounds, and drawing; selected IDs
 * still resolve through `ShiftObject` references.
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
