import type { MatModel } from "@shift/geo";
import { anchors, geometry } from "@shift/wasm";
import type { AnchorKind, FollowingComponent } from "@shift/wasm/protocol";

/**
 * Returns where each component shows while an edit is in progress.
 *
 * @remarks
 * Runs shift-font's `follow_anchors`, the rule the workspace applies when the
 * edit lands, so a drag shows what the commit will do: anchored components,
 * and unset ones last accepted on their anchors, sit on the current anchors.
 */
export function followingPlacements(components: readonly FollowingComponent[]): MatModel[] {
  return anchors
    .followAnchors(components)
    .map((following) => geometry.composeTransform(following.transform));
}

/** The role fontc reads from an anchor's name in mark positioning. */
export function anchorKind(name: string): AnchorKind {
  return anchors.anchorKind(name);
}

export type { AnchorKind };
