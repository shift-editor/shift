import type { MatModel } from "@shift/geo";
import { composeTransform } from "@shift/glyph-state";
import { followAnchors, type FollowingComponent } from "./generated/layouts";

/**
 * Returns where each component shows while an edit is in progress.
 *
 * @remarks
 * Runs shift-font's `follow_anchors`, the rule the workspace applies when the
 * edit lands, so a drag shows what the commit will do: anchored components,
 * and unset ones last accepted on their anchors, sit on the current anchors.
 */
export function followingPlacements(components: readonly FollowingComponent[]): MatModel[] {
  return followAnchors(components).map((following) => composeTransform(following.transform));
}
