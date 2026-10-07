import type { Behavior } from "../core/Behavior";
import type { ScenePoint } from "../../../types/coordinates";
import type { SpacingHalf } from "./RunSpacing";
import type { SpacingTool } from "./Spacing";

/** A value a dragged sidebearing snaps to. */
export type SpacingSnap = "otherHalf" | "otherSidebearing";

export type SpacingState =
  | { type: "idle" }
  | {
      type: "ready";
      /** The half under the pointer. */
      hit: SpacingHalf | null;
      /** The half arrow keys change, chosen by clicking, dragging, or typing it. */
      selected: SpacingHalf | null;
      /** Whether the pointer is over the active half's value pill, which opens on click. */
      overLabel?: boolean;
      /** Set by a key press to hide every overlay until the pointer moves. */
      quiet?: boolean;
    }
  | {
      type: "dragging";
      hit: SpacingHalf;
      origin: ScenePoint;
      /** What the dragged value snapped to: the gap's other half, the glyph's other sidebearing, or nothing. */
      snap: SpacingSnap | null;
    }
  | { type: "editing"; hit: SpacingHalf };

export type SpacingBehavior = Behavior<SpacingState, SpacingTool>;
