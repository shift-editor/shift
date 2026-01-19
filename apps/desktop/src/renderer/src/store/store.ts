import { create } from "zustand";

import { Editor } from "@/lib/editor/Editor";
import { registerBuiltInTools } from "@/lib/tools/tools";

/**
 * AppState is now minimal - just holds the editor singleton and UI-only state.
 * Tool state, selection, and hover are all managed on the Editor directly.
 */
interface AppState {
  editor: Editor;
  fileName: string;
  setFileName: (fileName: string) => void;
}

const AppState = create<AppState>()((set) => {
  const editor = new Editor();
  registerBuiltInTools(editor);

  // Set select tool as ready on startup
  editor.setActiveTool("select");

  return {
    editor,
    fileName: "",
    setFileName: (fileName: string) => {
      set({ fileName });
    },
  };
});

export const getEditor = () => AppState.getState().editor;

export default AppState;
