import { useEffect } from 'react';

import AppState from '@/store/store';

import { EditorView } from './EditorView';
import { Toolbar } from './Toolbar';

export const App = () => {
  useEffect(() => {
    const editor = AppState.getState().editor;
    const switchTool = AppState.getState().setActiveTool;
    const activeTool = editor.activeTool();

    // TODO: Make tool specific key handlers
    const keyDownHandler = (e: KeyboardEvent) => {
      if (e.key == '=' && e.metaKey) {
        editor.zoomIn();
        editor.requestRedraw();
        return;
      }

      if (e.key == '-' && e.metaKey) {
        editor.zoomOut();
        editor.requestRedraw();
        return;
      }

      if (e.key == 'h') {
        switchTool('hand');
        editor.requestRedraw();
      }

      if (e.key == ' ') {
        switchTool('hand');
        editor.setFillContour(true);
        editor.requestRedraw();
      }

      if (e.key == 'p') {
        switchTool('pen');
        editor.requestRedraw();
      }

      if (e.key == 's') {
        switchTool('shape');
        editor.requestRedraw();
      }

      if (e.key == 'v') {
        switchTool('select');
        editor.requestRedraw();
      }

      if (activeTool.keyDownHandler) {
        activeTool.keyDownHandler(e);
      }
    };

    const keyUpHandler = (e: KeyboardEvent) => {
      if (e.key == ' ') {
        switchTool('select');
        editor.setFillContour(false);
        editor.requestRedraw();
      }

      if (activeTool.keyUpHandler) {
        activeTool.keyUpHandler(e);
      }
    };

    document.addEventListener('keydown', keyDownHandler);
    document.addEventListener('keyup', keyUpHandler);

    return () => {
      document.removeEventListener('keydown', keyDownHandler);
      document.removeEventListener('keyup', keyUpHandler);
    };
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center">
      <Toolbar />
      <EditorView />
    </div>
  );
};
