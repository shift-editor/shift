import { create } from "zustand";
import { ToolName } from "../types/tool";

interface AppState {
  activeTool: ToolName;
  setActiveTool: (tool: ToolName) => void;
}

const AppState = create<AppState>()((set) => ({
  activeTool: "select",
  setActiveTool: (tool: ToolName) => set({ activeTool: tool }),
}));

export default AppState;
