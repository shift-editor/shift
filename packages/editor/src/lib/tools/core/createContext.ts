export const BUILT_IN_TOOL_IDS = {
  select: "select",
  pen: "pen",
  hand: "hand",
  shape: "shape",
  text: "text",
  disabled: "disabled",
} as const;

export type BuiltInToolId = (typeof BUILT_IN_TOOL_IDS)[keyof typeof BUILT_IN_TOOL_IDS];
export type ToolName = string;

export interface ToolState {
  type: string;
}
