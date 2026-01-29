import { Editor } from "@/lib/editor/Editor";
import { registerBuiltInTools } from "@/lib/tools/tools";
import { isDev } from "@/lib/utils/utils";
import { create } from "zustand";
import type { StoreApi } from "zustand";
import { persist } from "zustand/middleware";

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

const createStore = (set: StoreApi<AppState>["setState"]): AppState => {
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
};

const storeDev = persist((set): AppState => createStore(set), {
  name: "dev-app-state",
  partialize: (state) => ({ filePath: state.filePath }),
  storage: {
    getItem: (name) => {
      const str = sessionStorage.getItem(name);
      return str ? JSON.parse(str) : null;
    },
    setItem: (name, value) => {
      sessionStorage.setItem(name, JSON.stringify(value));
    },
    removeItem: (name) => sessionStorage.removeItem(name),
  },
  onRehydrateStorage: () => {
    console.log("onRehydrateStorage");

    return async (state) => {
      console.log("reloading loading font", state.filePath);
      state.editor.loadFont(state.filePath);
    };
  },
});

const AppState = create<AppState>()(isDev ? storeDev : createStore);

export const getEditor = () => AppState.getState().editor;
export const setFilePath = (path: string | null) => AppState.getState().setFilePath(path);
export const clearDirty = () => AppState.getState().clearDirty();
export const markDirty = () => AppState.getState().markDirty();

export default AppState;
