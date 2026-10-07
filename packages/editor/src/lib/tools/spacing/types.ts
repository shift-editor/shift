import type { Behavior } from "../core/Behavior";
import type { ScenePoint } from "../../../types/coordinates";
import type { SpacingGap, SpacingSideName } from "../../../types/spacing";

/** A value a dragged sidebearing snaps to. */
export type SpacingSnap = "otherHalf" | "otherSidebearing";

/** The gap under the pointer and the half of it the pointer is over. */
export interface SpacingHit {
  readonly gap: SpacingGap;
  readonly side: SpacingSideName;
}

export type SpacingState =
  | { type: "idle" }
  | {
      type: "ready";
      hit: SpacingHit | null;
      /** The half arrow keys change, chosen by clicking, dragging, or typing it. */
      selected: SpacingHit | null;
      /** Whether the pointer is over the active half's value pill, which opens on click. */
      overLabel?: boolean;
      /** Set by a key press to hide every overlay until the pointer moves. */
      quiet?: boolean;
    }
  | {
      type: "dragging";
      hit: SpacingHit;
      origin: ScenePoint;
      /** What the dragged value snapped to: the gap's other half, the glyph's other sidebearing, or nothing. */
      snap: SpacingSnap | null;
    }
  | { type: "editing"; hit: SpacingHit };

export type SpacingBehavior = Behavior<SpacingState>;
