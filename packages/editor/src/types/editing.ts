import type { GlyphId, NodeId } from "@shift/types";
import type { Glyph, GlyphLayer } from "../lib/model/Glyph";
import type { GlyphNode, NodeKind, NodeOfKind, ShiftNode } from "./node";
import type { NodeDefinitionByKind } from "./nodeDefinition";

declare const EditingIdBrand: unique symbol;
declare const PendingEditIdBrand: unique symbol;

export type EditingId = string & { readonly [EditingIdBrand]: typeof EditingIdBrand };

/** Renderer-local correlation identity for the pending → confirmed lifecycle. */
export type PendingEditId = number & {
  readonly [PendingEditIdBrand]: typeof PendingEditIdBrand;
};

export const currentEditingId = "editing:current" as EditingId;

/** Which scene nodes this editor session edits, and whether that editing is suspended. */
export interface EditingState {
  /** Nodes exposing editable internals now; empty while editing is suspended. */
  readonly nodeIds: readonly NodeId[];
  /** Nodes whose editing is suspended, kept to resume; empty unless suspended. */
  readonly suspendedNodeIds: readonly NodeId[];
}

/**
 * What tools and commands act on when they edit one node.
 *
 * @remarks
 * A node definition extends this with the model objects an edit of its kind
 * needs, so callers read them once instead of looking them up from the node.
 */
export interface NodeEditContext<N extends ShiftNode = ShiftNode> {
  readonly node: N;
}

/** Builds the edit context of one node; null when the node cannot be edited now. */
export type EditContextResolver = (node: ShiftNode) => NodeEditContext | null;

/** The glyph an edit of a glyph node acts on. */
export interface GlyphEditContext extends NodeEditContext<GlyphNode> {
  readonly glyphId: GlyphId;
  readonly glyph: Glyph;
  /** The glyph's layer at the active source; null at an interpolated location or with no layer there. */
  readonly layer: GlyphLayer | null;
}

/**
 * The edit context of a node of kind `K`: what its definition's `editContext`
 * returns, or just the node when the definition declares none.
 */
export type EditContextOfKind<K extends NodeKind> = K extends keyof NodeDefinitionByKind
  ? NodeDefinitionByKind[K] extends { editContext(node: never): infer Context }
    ? NonNullable<Context>
    : NodeEditContext<NodeOfKind<K>>
  : NodeEditContext<NodeOfKind<K>>;
