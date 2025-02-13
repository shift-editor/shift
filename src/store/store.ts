import { create } from "zustand";

import { Editor } from "@/lib/editor/Editor";
import { createToolRegistry } from "@/lib/tools/tools";
import { ToolName } from "@/types/tool";

interface AppState {
  editor: Editor;
  activeTool: ToolName;
  setActiveTool: (tool: ToolName) => void;
}

const AppState = create<AppState>()((set) => {
  const editor = new Editor();
  createToolRegistry(editor);

  return {
    editor,
    activeTool: "select",
    setActiveTool: (tool: ToolName) => {
      set({ activeTool: tool });
    },
  };
});

export const getEditor = () => AppState.getState().editor;

export default AppState;
