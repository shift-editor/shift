import { useEffect } from 'react';

import { useParams } from 'react-router-dom';

import { Toolbar } from '@/components/Toolbar';
import AppState from '@/store/store';

import { EditorView } from '../components/EditorView';

export const Editor = () => {
  const { glyphId } = useParams();

  useEffect(() => {
    const editor = AppState.getState().editor;
    const switchTool = AppState.getState().setActiveTool;
    const activeTool = editor.activeTool();

    const keyDownHandler = (e: KeyboardEvent) => {
      e.preventDefault();

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

      // we don't want to trigger a redraw when the space bar is
      // held down
      if (e.key == ' ' && !e.repeat) {
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
  }, [glyphId]);

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-white">
      <Toolbar />
      <EditorView glyphId={glyphId ?? ''} />
    </div>
  );
};
