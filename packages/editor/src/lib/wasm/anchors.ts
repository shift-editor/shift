import { Mat, type MatModel } from "@shift/geo";
import {
  followAnchors,
  propagateAnchors as propagate,
  type FollowingComponent,
  type PropagatedAnchors,
  type PropagationGlyph,
} from "./generated/layouts";

/** An anchor's role in mark positioning, and the kind fontc reads from a name. */
export { anchorKind, type AnchorKind } from "@shift/wasm";

export type {
  AlignmentAnchor,
  FollowingComponent,
  PropagatedAnchors,
  PropagationAnchor,
  PropagationComponent,
  PropagationGlyph,
} from "./generated/layouts";

/**
 * Returns a glyph's anchors as export compiles them, its components' copied in.
 *
 * @remarks
 * Runs shift-font's `anchor_propagation`, the port of fontc's propagation that
 * Rust tests against fontc. A glyph without components keeps its own anchors
 * as authored. Components must already be propagated: callers recurse into
 * component glyphs first.
 */
export function propagateAnchors(glyph: PropagationGlyph): PropagatedAnchors {
  return propagate(glyph);
}

/**
 * Returns where each component shows while an edit is in progress.
 *
 * @remarks
 * Runs shift-font's `follow_anchors`, the rule the workspace applies when the
 * edit lands, so a drag shows what the commit will do: anchored components,
 * and unset ones last accepted on their anchors, sit on the current anchors.
 */
export function followingPlacements(components: readonly FollowingComponent[]): MatModel[] {
  return followAnchors(components).map((following) => Mat.fromDecomposed(following.transform));
}
