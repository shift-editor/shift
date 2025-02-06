import { create } from "zustand";

import { Editor } from "@/lib/editor/Editor";
import { ToolName } from "@/types/tool";

interface AppState {
  editor: Editor;
  activeTool: ToolName;
  setActiveTool: (tool: ToolName) => void;
}

const AppState = create<AppState>()((set) => ({
  editor: new Editor(),
  activeTool: "select",
  setActiveTool: (tool: ToolName) => {
    set({ activeTool: tool });
  },
}));

export default AppState;
