import type { Rect2D } from "@shift/geo";
import type { Editor } from "@/lib/editor/Editor";
import type { NodePoint } from "@/types/coordinates";
import type { ShiftNode } from "@/types/node";
import type { PointerTarget } from "@/types/target";
import type { RenderContext, RenderPass } from "@/types/rendering";

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
   * Returns scene-space bounds for a node.
   *
   * @param node - scene node handled by this definition.
   * @returns null when this node has no bounds for selection or hit expansion.
   */
  abstract bounds(node: N): Rect2D | null;

  /**
   * Hit-tests a node-local pointer position.
   *
   * @param node - scene node handled by this definition.
   * @param point - pointer position already converted into the node's local coordinate space.
   * @returns the top target for this node, or null when the node was not hit.
   */
  abstract hit(node: N, point: NodePoint): PointerTarget | null;

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
export interface NodeDefinitionConstructor {
  new (editor: Editor): NodeDefinition;
}
