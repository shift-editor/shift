import { create } from "zustand";

import { Editor } from "@/lib/editor/Editor";
import { registerBuiltInTools } from "@/lib/tools/tools";

interface AppState {
  editor: Editor;
  fileName: string | null;
  filePath: string | null;
  isDirty: boolean;
  setFileName: (fileName: string) => void;
  setFilePath: (filePath: string | null) => void;
  setDirty: (dirty: boolean) => void;
  markDirty: () => void;
  clearDirty: () => void;
}

function getFileNameFromPath(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || null;
}

const AppState = create<AppState>()((set) => {
  const editor = new Editor();
  registerBuiltInTools(editor);

  // Set select tool as ready on startup
  editor.setActiveTool("select");

  const markDirty = () => {
    set({ isDirty: true });
    window.electronAPI?.setDocumentDirty(true);
  };

  editor.commandHistory.setOnDirty(markDirty);

  return {
    editor,
    fileName: null,
    filePath: null,
    isDirty: false,
    setFileName: (fileName: string) => {
      set({ fileName });
    },
    setFilePath: (filePath: string | null) => {
      set({
        filePath,
        fileName: getFileNameFromPath(filePath),
      });
    },
    setDirty: (dirty: boolean) => {
      set({ isDirty: dirty });
    },
    markDirty,
    clearDirty: () => {
      set({ isDirty: false });
      window.electronAPI?.setDocumentDirty(false);
    },
  };
});

export const getEditor = () => AppState.getState().editor;

export default AppState;
