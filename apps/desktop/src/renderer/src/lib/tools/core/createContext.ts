<<<<<<< Updated upstream
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
=======
export type ToolName = "select" | "pen" | "hand" | "shape" | "text" | "disabled";
>>>>>>> Stashed changes

export interface ToolState {
  type: string;
}
