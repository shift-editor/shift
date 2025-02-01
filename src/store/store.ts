import { create } from "zustand";
import { ToolName } from "../types/tool";
import { Scene } from "../lib/editor/Scene";

interface AppState {
  upm: number;
  scene: Scene;
  activeTool: ToolName;
  setActiveTool: (tool: ToolName) => void;
}

const AppState = create<AppState>()((set) => ({
  upm: 1000,
  scene: new Scene(),
  activeTool: "select",
  setActiveTool: (tool: ToolName) => set({ activeTool: tool }),
}));

export default AppState;
