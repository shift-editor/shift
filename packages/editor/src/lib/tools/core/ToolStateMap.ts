import type { ToolName, ToolState } from "./createContext";
import type { HandState } from "../hand/types";
import type { ShapeState } from "../shape/types";
import type { SelectState } from "../select/types";
import type { PenState } from "../pen/types";
import type { TextState } from "../text/types";

export interface ToolStateMap {
  hand: HandState;
  select: SelectState;
  pen: PenState;
  shape: ShapeState;
  text: TextState;
  disabled: ToolState;
}

/** Resolves known tool IDs precisely and leaves runtime extension IDs at the base contract. */
export type ToolStateFor<Id extends ToolName> = Id extends keyof ToolStateMap
  ? ToolStateMap[Id]
  : ToolState;

/** Active tool identity paired with the current state published by that tool. */
export interface ActiveTool<Id extends ToolName = ToolName> {
  readonly id: Id;
  readonly state: ToolStateFor<Id>;
}
