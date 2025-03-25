import { Glyph } from '@shift/shared';
import { create } from 'zustand';

import { TauriEventEmitter } from '@/lib/core/EventEmitter';
import { Editor } from '@/lib/editor/Editor';
import { createToolRegistry } from '@/lib/tools/tools';
import { ToolName } from '@/types/tool';

interface AppState {
  editor: Editor;
  fileName: string;
  currentGlyph: Glyph | null;
  activeTool: ToolName;
  setActiveTool: (tool: ToolName) => void;
  setActiveGlyph: (glyph: Glyph) => void;
}

const AppState = create<AppState>()((set) => {
  const tauriEventEmitter = new TauriEventEmitter();
  const editor = new Editor(tauriEventEmitter);
  createToolRegistry(editor);

  return {
    editor,
    currentGlyph: null,
    fileName: '',
    activeTool: 'select',
    setActiveTool: (tool: ToolName) => {
      set({ activeTool: tool });
    },
    setActiveGlyph: (glyph: Glyph) => {
      set({ currentGlyph: glyph });
    },
    setFileName: (fileName: string) => {
      set({ fileName });
    },
  };
});

export const getEditor = () => AppState.getState().editor;

export default AppState;
