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

  editor.on("point:added", ({ pointId }) => {
    console.log("point:added", pointId);

    editor.redrawContour(pointId);
  });

  editor.on("point:moved", ({ pointId }) => {
    console.log("point:moved", pointId);

    editor.redrawContour(pointId);
  });

  editor.on("point:removed", ({ pointId }) => {
    console.log("point:removed", pointId);
    editor.requestRedraw();
  });

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
