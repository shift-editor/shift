import { Editor } from "@/lib/editor/Editor";
import { electronSystemClipboard } from "@/lib/clipboard";
import { registerBuiltInTools } from "@/lib/tools/tools";
import { create } from "zustand";
import type { StoreApi } from "zustand";
import type { ShiftBridge } from "@shift/bridge";
import { defaultResources, GlyphInfo } from "@shift/glyph-info";

interface AppState {
  editor: Editor;
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

const createStore = (__set: StoreApi<AppState>["setState"]): AppState => {
  const editor = new Editor({
    bridge: createShiftBridge(),
    clipboard: electronSystemClipboard,
  });
  registerBuiltInTools(editor);

  // Set select tool as ready on startup
  editor.setActiveTool("select");

  return {
    editor,
  };
};

const AppState = create<AppState>()(createStore);

export const getEditor = () => AppState.getState().editor;

// Expose editor on window for Playwright E2E tests.
declare const __PLAYWRIGHT__: boolean | undefined;
if (typeof __PLAYWRIGHT__ !== "undefined" && __PLAYWRIGHT__) {
  (window as unknown as Record<string, unknown>).__shift = { getEditor };
}
