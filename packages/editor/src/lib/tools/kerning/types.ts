import type { Behavior } from "../core/Behavior";
import type { ScenePoint } from "../../../types/coordinates";
import type { KerningLabelTarget } from "./KerningLabel";
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
      /** The part of the hovered pair's pill under the pointer. */
      overLabel?: KerningLabelTarget | null;
      /** Set by a key press to hide every overlay until the pointer moves. */
      quiet?: boolean;
    }
  | { type: "dragging"; hit: KerningPair; origin: ScenePoint; start: number }
  | { type: "editing"; hit: KerningPair };

export type KerningBehavior = Behavior<KerningState, KerningTool>;
