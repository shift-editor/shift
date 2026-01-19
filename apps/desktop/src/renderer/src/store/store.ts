import { create } from "zustand";

import { Editor } from "@/lib/editor/Editor";
import { registerBuiltInTools } from "@/lib/tools/tools";

interface AppState {
  editor: Editor;
  fileName: string | null;
  setFileName: (fileName: string) => void;
}

const AppState = create<AppState>()((set) => {
  const editor = new Editor();
  registerBuiltInTools(editor);

  // Set select tool as ready on startup
  editor.setActiveTool("select");

  return {
    editor,
    fileName: null,
    setFileName: (fileName: string) => {
      set({ fileName });
    },
  };
});

export const getEditor = () => AppState.getState().editor;

export default AppState;
