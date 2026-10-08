import type { Behavior } from "../core/Behavior";
import type { ScenePoint } from "../../../types/coordinates";
import type { KerningPair } from "./RunKerning";
import type { KerningTool } from "./Kerning";

export type KerningState =
  | { type: "idle" }
  | {
      type: "ready";
      /** The pair under the pointer. */
      hit: KerningPair | null;
      /** The pair arrow keys change, chosen by clicking, dragging, or typing it. */
      selected: KerningPair | null;
      /** Whether the pointer is on the hovered pair's pill. */
      overLabel?: boolean;
      /** Set by a key press to hide every overlay until the pointer moves. */
      quiet?: boolean;
    }
  | { type: "dragging"; hit: KerningPair; origin: ScenePoint; start: number }
  | { type: "editing"; hit: KerningPair };

export type KerningBehavior = Behavior<KerningState, KerningTool>;
