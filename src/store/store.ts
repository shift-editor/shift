import { create } from "zustand";

import { Scene } from "@/lib/editor/Scene";
import { ViewportManager } from "@/lib/editor/ViewportManager";

import { ToolName } from "../types/tool";

interface AppState {
  upm: number;
  padding: number;
  viewportManager: ViewportManager;
  scene: Scene;
  activeTool: ToolName;
  setActiveTool: (tool: ToolName) => void;
}

const AppState = create<AppState>()((set) => ({
  upm: 1000,
  padding: 100,
  viewportManager: new ViewportManager(),
  scene: new Scene(),
  activeTool: "select",
  setActiveTool: (tool: ToolName) => {
    set({ activeTool: tool });
    console.log(tool);
  },
}));

export default AppState;
