import type { BaseTool } from "./BaseTool";
import type { ToolName, ToolState } from "./createContext";
import type { Hand } from "../hand/Hand";
import type { HandState } from "../hand/types";
import type { KerningTool } from "../kerning/Kerning";
import type { KerningState } from "../kerning/types";
import type { Pen } from "../pen/Pen";
import type { PenState } from "../pen/types";
import type { Select } from "../select/Select";
import type { SelectState } from "../select/types";
import type { ShapeTool } from "../shape/ShapeTool";
import type { ShapeState } from "../shape/types";
import type { SpacingTool } from "../spacing/Spacing";
import type { SpacingState } from "../spacing/types";
import type { TextTool } from "../text/Text";
import type { TextState } from "../text/types";

export interface ToolStateMap {
  hand: HandState;
  select: SelectState;
  pen: PenState;
  shape: ShapeState;
  text: TextState;
  spacing: SpacingState;
  kerning: KerningState;
  disabled: ToolState;
}

/** Built-in tool identities and the classes that implement them. */
export interface ToolMap {
  hand: Hand;
  select: Select;
  pen: Pen;
  shape: ShapeTool;
  text: TextTool;
  spacing: SpacingTool;
  kerning: KerningTool;
}

/** Resolves known tool IDs precisely and leaves runtime extension IDs at the base contract. */
export type ToolStateFor<Id extends ToolName> = Id extends keyof ToolStateMap
  ? ToolStateMap[Id]
  : ToolState;

/**
 * Resolves a built-in tool ID to its class; any other ID resolves to a
 * {@link BaseTool} holding that ID's state.
 */
export type ToolFor<Id extends ToolName> = Id extends keyof ToolMap
  ? ToolMap[Id]
  : BaseTool<ToolStateFor<Id>>;

/** Active tool identity paired with the current state published by that tool. */
export interface ActiveTool<Id extends ToolName = ToolName> {
  readonly id: Id;
  readonly state: ToolStateFor<Id>;
}
