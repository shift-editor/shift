import { create } from "zustand";

import { Editor } from "@/lib/editor/Editor";
import { createToolRegistry, tools } from "@/lib/tools/tools";
import { ToolName } from "@/types/tool";
import type { GlyphSnapshot } from "@/types/generated";

interface AppState {
  editor: Editor;
  fileName: string;
  currentGlyph: GlyphSnapshot | null;
  activeTool: ToolName;
  setActiveTool: (tool: ToolName) => void;
  setActiveGlyph: (glyph: GlyphSnapshot) => void;
  setFileName: (fileName: string) => void;
}

const AppState = create<AppState>()((set, get) => {
  const editor = new Editor();
  createToolRegistry(editor);

  return {
    editor,
    currentGlyph: null,
    fileName: "",
    activeTool: "select",
    setActiveTool: (tool: ToolName) => {
      const currentTool = get().activeTool;
      if (currentTool === tool) return;

      // Deactivate the current tool
      const oldTool = tools.get(currentTool);
      if (oldTool) {
        oldTool.tool.setIdle();
      }

      // Activate the new tool
      const newTool = tools.get(tool);
      if (newTool) {
        newTool.tool.setReady();
      }

      set({ activeTool: tool });
    },
    setActiveGlyph: (glyph: GlyphSnapshot) => {
      set({ currentGlyph: glyph });
    },
    setFileName: (fileName: string) => {
      set({ fileName });
    },
  };
});

export const getEditor = () => AppState.getState().editor;

export default AppState;
