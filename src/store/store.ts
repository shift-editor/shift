import { create } from "zustand";

import { CanvasContext } from "../lib/editor/CanvasContext";
import { Scene } from "../lib/editor/Scene";
import { ToolName } from "../types/tool";

interface AppState {
  upm: number;
  canvasContext: CanvasContext;
  scene: Scene;
  activeTool: ToolName;
  setActiveTool: (tool: ToolName) => void;
}

const AppState = create<AppState>()((set) => ({
  upm: 1000,
  canvasContext: new CanvasContext(),
  scene: new Scene(),
  activeTool: "select",
  setActiveTool: (tool: ToolName) => set({ activeTool: tool }),
}));

export default AppState;
