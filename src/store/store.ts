import { create } from "zustand";
import { ToolName } from "../types/tool";
import { PathManager } from "../lib/editor/PathManager";

interface AppState {
  pathManager: PathManager;
  activeTool: ToolName;
  setActiveTool: (tool: ToolName) => void;
}

const AppState = create<AppState>()((set) => ({
  pathManager: new PathManager(),
  activeTool: "select",
  setActiveTool: (tool: ToolName) => set({ activeTool: tool }),
}));

export default AppState;
