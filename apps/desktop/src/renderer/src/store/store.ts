import { Editor } from "@/lib/editor/Editor";
import { Document } from "@/app/Document";
import { electronSystemClipboard } from "@/lib/clipboard";
import { registerBuiltInTools } from "@/lib/tools/tools";
import { create } from "zustand";
import type { StoreApi } from "zustand";
import type { ShiftBridge } from "@shift/bridge";
import { defaultResources, GlyphInfo } from "@shift/glyph-info";

interface AppState {
  document: Document;
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

function createShiftBridge(): ShiftBridge {
  if (!window.shiftBridge) {
    throw Error("native bridge has not been exposed by preload");
  }

  return window.shiftBridge;
}

let instance: GlyphInfo | null = null;
export function getGlyphInfo(): GlyphInfo {
  if (!instance) instance = new GlyphInfo(defaultResources);
  return instance;
}

const createStore = (set: StoreApi<AppState>["setState"]): AppState => {
  const editor = new Editor({
    bridge: createShiftBridge(),
    clipboard: electronSystemClipboard,
  });
  registerBuiltInTools(editor);

  // Set select tool as ready on startup
  editor.setActiveTool("select");

  const markDirty = () => {
    set({ isDirty: true });
    window.electronAPI?.setDocumentDirty(true);
  };

  editor.commandHistory.setOnDirty(markDirty);

  const setFilePath = (filePath: string | null) => {
    set({
      filePath,
      fileName: getFileNameFromPath(filePath),
    });
    window.electronAPI?.setDocumentFilePath(filePath);
  };

  const clearDirty = () => {
    set({ isDirty: false });
    window.electronAPI?.setDocumentDirty(false);
  };

  const document = new Document(editor, {
    setFilePath,
    clearDirty,
    notifySaveCompleted: (path) => window.electronAPI?.saveCompleted(path),
  });

  return {
    document,
    editor,
    fileName: null,
    filePath: null,
    isDirty: false,
    setFileName: (fileName: string) => {
      set({ fileName });
    },
    setFilePath,
    setDirty: (dirty: boolean) => {
      set({ isDirty: dirty });
    },
    markDirty,
    clearDirty,
  };
};

const AppState = create<AppState>()(createStore);

export const getDocument = () => AppState.getState().document;
export const getEditor = () => AppState.getState().editor;
export const markDocumentDirty = () => AppState.getState().markDirty();

// Expose editor on window for Playwright E2E tests.
declare const __PLAYWRIGHT__: boolean | undefined;
if (typeof __PLAYWRIGHT__ !== "undefined" && __PLAYWRIGHT__) {
  (window as unknown as Record<string, unknown>).__shift = { getEditor };
}
