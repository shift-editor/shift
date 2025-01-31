import { create } from "zustand";
import { ToolName } from "../types/tool";
import { Scene } from "../lib/editor/Scene";

interface AppState {
  scene: Scene;
  activeTool: ToolName;
  setActiveTool: (tool: ToolName) => void;
}

const AppState = create<AppState>()((set) => ({
  scene: new Scene(),
  activeTool: "select",
  setActiveTool: (tool: ToolName) => set({ activeTool: tool }),
}));

export default AppState;
