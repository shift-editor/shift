import { Editor } from "@/lib/editor/Editor";
import { NativeBridge } from "@/bridge/NativeBridge";
import { electronSystemClipboard } from "@/lib/clipboard";
import { registerBuiltInTools } from "@/lib/tools/tools";
import { create } from "zustand";
import type { StoreApi } from "zustand";

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
  const editor = new Editor({
    bridge: new NativeBridge(),
    systemClipboard: electronSystemClipboard,
  });
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
      window.electronAPI?.setDocumentFilePath(filePath);
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

const AppState = create<AppState>()(createStore);

export const getEditor = () => AppState.getState().editor;

// Expose editor on window for Playwright E2E tests.
declare const __PLAYWRIGHT__: boolean | undefined;
if (typeof __PLAYWRIGHT__ !== "undefined" && __PLAYWRIGHT__) {
  (window as unknown as Record<string, unknown>).__shift = { getEditor };
}
export const setFilePath = (path: string | null) => AppState.getState().setFilePath(path);
export const clearDirty = () => AppState.getState().clearDirty();
