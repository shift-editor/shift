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
      if (e.key === '=' && e.metaKey) {
        e.preventDefault();
        editor.zoomIn();
        editor.requestRedraw();
        return;
      }

      if (e.key === '-' && e.metaKey) {
        e.preventDefault();
        editor.zoomOut();
        editor.requestRedraw();
        return;
      }

      if (e.key === 'h') {
        e.preventDefault();
        switchTool('hand');
        editor.requestRedraw();
        return;
      }

      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        switchTool('hand');
        editor.setFillContour(true);
        editor.requestRedraw();
        return;
      }

      if (e.key === 'p') {
        e.preventDefault();
        switchTool('pen');
        editor.requestRedraw();
        return;
      }

      if (e.key === 's') {
        e.preventDefault();
        switchTool('shape');
        editor.requestRedraw();
        return;
      }

      if (e.key === 'v') {
        e.preventDefault();
        switchTool('select');
        editor.requestRedraw();
        return;
      }

      if (e.key === 'z' && e.metaKey && !e.shiftKey) {
        e.preventDefault();
        editor.undo();
        return;
      }

      if (e.key === 'z' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        editor.redo();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const selectedPoints = editor.selectedPoints;
        if (selectedPoints.size > 0) {
          editor.fontEngine.editing.removePoints([...selectedPoints]);
          editor.clearSelectedPoints();
          editor.requestRedraw();
        }
        return;
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

  useEffect(() => {
    const editor = AppState.getState().editor;

    const unsubscribeUndo = window.electronAPI?.onMenuUndo(() => editor.undo());
    const unsubscribeRedo = window.electronAPI?.onMenuRedo(() => editor.redo());
    const unsubscribeDelete = window.electronAPI?.onMenuDelete(() => {
      const selectedPoints = editor.selectedPoints;
      if (selectedPoints.size > 0) {
        editor.fontEngine.editing.removePoints([...selectedPoints]);
        editor.clearSelectedPoints();
        editor.requestRedraw();
      }
    });

    return () => {
      unsubscribeUndo?.();
      unsubscribeRedo?.();
      unsubscribeDelete?.();
    };
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-white">
      <Toolbar />
      <EditorView glyphId={glyphId ?? ''} />
    </div>
  );
};
