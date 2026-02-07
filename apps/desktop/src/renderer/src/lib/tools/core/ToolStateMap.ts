import type { ToolName, ToolState } from "./createContext";
import type { HandState } from "../hand/types";
import type { ShapeState } from "../shape/types";
import type { SelectState } from "../select/types";
import type { PenState } from "../pen/types";
import { TextState } from "../text/types";

export interface ToolStateMap {
  hand: HandState;
  select: SelectState;
  pen: PenState;
  shape: ShapeState;
  disabled: ToolState;
  text: TextState;
}

export type ActiveToolState = ToolStateMap[ToolName];
